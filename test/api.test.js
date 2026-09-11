import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import request from "supertest";
import { createApp } from "../src/app.js";
import { id, passwordHash, hash, decrypt, paise } from "../src/core.js";
const secret = "test-only-".repeat(8),
  config = {
    secret,
    origins: ["http://localhost:3000"],
    publicUrl: "http://localhost:5003",
    production: false,
  };
let db,
  api,
  adminToken,
  userToken,
  user2Token,
  userId,
  user2Id,
  planId,
  taskId,
  depositId,
  withdrawalId,
  submissionId,
  proofId;
const proof = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("test proof payload"),
]);
const bank = {
  accountHolderName: "Test User",
  bankName: "Test Bank",
  accountNumber: "1234567890",
  ifscCode: "TEST0123456",
};
const headers = (token, key) => ({
  Authorization: `Bearer ${token}`,
  ...(key ? { "Idempotency-Key": key } : {}),
});
async function seed(role, n) {
  const uid = id(),
    token = id() + id() + id().slice(0, 16);
  await db.query(
    "INSERT INTO users(id,full_name,email,phone_number,password_hash,role,is_verified) VALUES($1,$2,$3,$4,$5,$6,true)",
    [
      uid,
      "Test User",
      `user${n}@example.test`,
      `900000000${n}`,
      await passwordHash("TestingPassword!"),
      role,
    ],
  );
  await db.query("INSERT INTO wallets(user_id) VALUES($1)", [uid]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(token), uid],
  );
  return { uid, token };
}
before(async () => {
  const sql = await readFile(
    new URL("../migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  if (process.env.TEST_DATABASE_URL) {
    const schema = "test_" + id();
    const base = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await base.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    db = {
      query: (q, p) => pool.query(q, p),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const v = await fn(c);
          await c.query("COMMIT");
          return v;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      async close() {
        await pool.end();
        await base.query(`DROP SCHEMA ${schema} CASCADE`);
        await base.end();
      },
    };
    await db.query(sql);
  } else {
    const p = new PGlite();
    await p.exec(sql);
    db = {
      query: (q, args) => p.query(q, args),
      tx: (fn) =>
        p.transaction((c) => fn({ query: (q, args) => c.query(q, args) })),
      close: () => p.close(),
    };
  }
  api = request(createApp(db, config));
  const a = await seed("admin", 1),
    u = await seed("user", 2),
    u2 = await seed("user", 3);
  adminToken = a.token;
  userToken = u.token;
  userId = u.uid;
  user2Token = u2.token;
  user2Id = u2.uid;
});
after(async () => {
  if (db) await db.close();
});
test("money rejects rounding, negative, zero, and scientific notation", () => {
  assert.equal(paise("12.30"), 1230);
  for (const x of ["0", "-1", "1.001", "1e3", "100000000"])
    assert.throws(() => paise(x));
});
test("authentication, RBAC, and profile privilege escalation", async () => {
  await api.get("/api/wallet").expect(401);
  await api.get("/api/admin/users").set(headers(userToken)).expect(403);
  await api
    .put("/api/auth/update-profile")
    .set(headers(userToken))
    .send({ role: "admin" })
    .expect(422);
  const r = await api.get("/api/auth/me").set(headers(userToken)).expect(200);
  assert.equal(r.body.data.passwordHash, undefined);
});
test("catalog CRUD, validation, and soft deletion", async () => {
  await api
    .post("/api/plans/admin")
    .set(headers(adminToken))
    .send({ name: "Bad", amount: -1 })
    .expect(422);
  let r = await api
    .post("/api/plans/admin")
    .set(headers(adminToken))
    .send({ name: "Gold", amount: 1399, description: "Test plan" })
    .expect(201);
  planId = r.body.data.id;
  await api
    .put(`/api/plans/admin/${planId}`)
    .set(headers(adminToken))
    .send({ name: "Gold", amount: 1499, description: "Updated" })
    .expect(200);
  await api
    .patch(`/api/admin/${planId}/toggle`)
    .set(headers(adminToken))
    .expect(200);
  r = await api.get("/api/plans").set(headers(userToken)).expect(200);
  assert.equal(r.body.data.items.length, 0);
  await api
    .patch(`/api/plans/admin/${planId}/toggle`)
    .set(headers(adminToken))
    .expect(200);
});
test("deposit creation requires idempotency and validates file contents", async () => {
  await api
    .post("/api/deposits")
    .set(headers(userToken, "bad-proof-key"))
    .field("planId", planId)
    .field("amount", "100")
    .field("transactionRef", "BAD-REF")
    .attach("paymentProof", Buffer.from("<script>bad</script>"), "x.png")
    .expect(422);
  await api
    .post("/api/deposits")
    .set(headers(userToken))
    .field("planId", planId)
    .field("amount", "100")
    .field("transactionRef", "REF0")
    .attach("paymentProof", proof, "p.png")
    .expect(422);
  const r = await api
    .post("/api/deposits")
    .set(headers(userToken, "deposit-key-1"))
    .field("planId", planId)
    .field("amount", "100")
    .field("transactionRef", "REF1")
    .attach("paymentProof", proof, "p.png")
    .expect(201);
  depositId = r.body.data.id;
  proofId = r.body.data.proofId;
  const replay = await api
    .post("/api/deposits")
    .set(headers(userToken, "deposit-key-1"))
    .field("planId", planId)
    .field("amount", "100")
    .field("transactionRef", "REF1")
    .attach("paymentProof", proof, "p.png")
    .expect(201);
  assert.equal(replay.body.data.id, depositId);
});
test("private proof authorization and content disposition", async () => {
  await api.get(`/api/files/${proofId}`).expect(401);
  await api.get(`/api/files/${proofId}`).set(headers(user2Token)).expect(404);
  const r = await api
    .get(`/api/files/${proofId}`)
    .set(headers(userToken))
    .expect(200);
  assert.match(r.headers["content-disposition"], /attachment/);
  await api.get(`/api/files/${proofId}`).set(headers(adminToken)).expect(200);
});
test("deposit approval credits exactly once, conflicting review rejected", async () => {
  await api
    .put(`/api/deposits/admin/${depositId}/approve`)
    .set(headers(userToken, "forbidden-key"))
    .send({})
    .expect(403);
  await api
    .put(`/api/deposits/admin/${depositId}/approve`)
    .set(headers(adminToken, "approve-deposit-1"))
    .send({})
    .expect(200);
  await api
    .put(`/api/deposits/admin/${depositId}/approve`)
    .set(headers(adminToken, "approve-deposit-2"))
    .send({})
    .expect(200);
  await api
    .put(`/api/deposits/admin/${depositId}/reject`)
    .set(headers(adminToken, "reject-deposit-1"))
    .send({ reason: "No" })
    .expect(409);
  const r = await api.get("/api/wallet").set(headers(userToken)).expect(200);
  assert.equal(r.body.data.balance, 100);
});
test("insufficient withdrawal rolls back, reserved funds cannot be spent twice", async () => {
  await api
    .post("/api/withdrawals")
    .set(headers(userToken, "withdraw-too-much"))
    .send({ amount: 101, bankDetails: bank })
    .expect(409);
  const r = await api
    .post("/api/withdrawals")
    .set(headers(userToken, "withdraw-reserve"))
    .send({ amount: 70, bankDetails: bank })
    .expect(201);
  withdrawalId = r.body.data.id;
  await api
    .post("/api/withdrawals")
    .set(headers(userToken, "withdraw-too-much-2"))
    .send({ amount: 40, bankDetails: bank })
    .expect(409);
  assert.equal(
    (await api.get("/api/wallet").set(headers(userToken))).body.data.balance,
    30,
  );
  const raw = (
    await db.query("SELECT bank_encrypted FROM withdrawals WHERE id=$1", [
      withdrawalId,
    ])
  ).rows[0];
  assert.ok(!raw.bank_encrypted.includes(bank.accountNumber));
});
test("withdrawal rejection refunds once and requires reason", async () => {
  await api
    .put(`/api/withdrawals/admin/${withdrawalId}/reject`)
    .set(headers(adminToken, "withdraw-reject-0"))
    .send({})
    .expect(422);
  await api
    .put(`/api/withdrawals/admin/${withdrawalId}/reject`)
    .set(headers(adminToken, "withdraw-reject-1"))
    .send({ reason: "Invalid bank details" })
    .expect(200);
  await api
    .put(`/api/withdrawals/admin/${withdrawalId}/reject`)
    .set(headers(adminToken, "withdraw-reject-2"))
    .send({ reason: "Invalid bank details" })
    .expect(200);
  assert.equal(
    (await api.get("/api/wallet").set(headers(userToken))).body.data.balance,
    100,
  );
});
test("withdrawal approval requires bank transfer reference and does not debit twice", async () => {
  const r = await api
    .post("/api/withdrawals")
    .set(headers(userToken, "withdraw-paid"))
    .send({ amount: 10, bankDetails: bank })
    .expect(201);
  await api
    .put(`/api/withdrawals/admin/${r.body.data.id}/approve`)
    .set(headers(adminToken, "payout-no-reference"))
    .send({})
    .expect(422);
  await api
    .put(`/api/withdrawals/admin/${r.body.data.id}/approve`)
    .set(headers(adminToken, "payout-reference"))
    .send({ payoutRef: "BANK-UTR-TEST" })
    .expect(200);
  assert.equal(
    (await api.get("/api/wallet").set(headers(userToken))).body.data.balance,
    90,
  );
});
test("task reward is snapshotted, submission duplication prevented", async () => {
  let r = await api
    .post("/api/tasks/admin")
    .set(headers(adminToken))
    .send({ title: "Test", description: "Complete task", rewardAmount: 25 })
    .expect(201);
  taskId = r.body.data.id;
  r = await api
    .post(`/api/tasks/${taskId}/submit`)
    .set(headers(userToken, "task-submit-1"))
    .attach("proof", proof, "task.png")
    .expect(201);
  submissionId = r.body.data.id;
  await api
    .post(`/api/tasks/${taskId}/submit`)
    .set(headers(userToken, "task-submit-2"))
    .attach("proof", proof, "task.png")
    .expect(409);
  await api
    .put(`/api/tasks/admin/${taskId}`)
    .set(headers(adminToken))
    .send({ title: "Test", description: "Updated task", rewardAmount: 99 })
    .expect(200);
  await api
    .put(`/api/tasks/admin/submissions/${submissionId}/approve`)
    .set(headers(adminToken, "task-approve-1"))
    .send({})
    .expect(200);
  assert.equal(
    (await api.get("/api/wallet").set(headers(userToken))).body.data.balance,
    115,
  );
});
test("gift limits, uniqueness and disabled/expired codes", async () => {
  const r = await api
    .post("/api/gift-codes/admin")
    .set(headers(adminToken))
    .send({
      code: "GIFT50",
      rewardAmount: 50,
      maxUsers: 1,
      expiryDate: "2099-10-31T23:59:59.000Z",
    })
    .expect(201);
  await api
    .post("/api/gift-codes/redeem")
    .set(headers(userToken, "gift-redeem-1"))
    .send({ code: "gift50" })
    .expect(201);
  await api
    .post("/api/gift-codes/redeem")
    .set(headers(user2Token, "gift-redeem-2"))
    .send({ code: "GIFT50" })
    .expect(409);
  await api
    .post("/api/gift-codes/redeem")
    .set(headers(userToken, "gift-redeem-3"))
    .send({ code: "GIFT50" })
    .expect(409);
  await api
    .put(`/api/gift-codes/admin/${r.body.data.id}`)
    .set(headers(adminToken))
    .send({
      code: "CHANGED",
      rewardAmount: 50,
      maxUsers: 1,
      expiryDate: "2099-10-31T23:59:59.000Z",
    })
    .expect(409);
});
test("wallet adjustment idempotency conflict and debit guard", async () => {
  await api
    .post("/api/wallet/admin/adjust")
    .set(headers(adminToken, "adjust-wallet-1"))
    .send({ userId, amount: 5, type: "credit", description: "Test bonus" })
    .expect(200);
  await api
    .post("/api/wallet/admin/adjust")
    .set(headers(adminToken, "adjust-wallet-1"))
    .send({ userId, amount: 6, type: "credit", description: "Test bonus" })
    .expect(409);
  await api
    .post("/api/wallet/admin/adjust")
    .set(headers(adminToken, "adjust-wallet-2"))
    .send({ userId, amount: 9999, type: "debit", description: "Too much" })
    .expect(409);
});
test("ownership, pagination, search and notifications", async () => {
  let r = await api.get("/api/deposits").set(headers(user2Token)).expect(200);
  assert.equal(r.body.data.pagination.total, 0);
  await api.get("/api/deposits?page=0").set(headers(userToken)).expect(422);
  r = await api.get("/api/notifications").set(headers(userToken)).expect(200);
  assert.ok(r.body.data.items.length > 0);
  const n = r.body.data.items[0].id;
  await api
    .patch(`/api/notifications/${n}/read`)
    .set(headers(user2Token))
    .expect(404);
  await api
    .patch(`/api/notifications/${n}/read`)
    .set(headers(userToken))
    .expect(200);
  await api
    .patch("/api/notifications/read-all")
    .set(headers(userToken))
    .expect(200);
  assert.equal(
    (await api.get("/api/notifications/unread-count").set(headers(userToken)))
      .body.data.count,
    0,
  );
});
test("maintenance blocks user mutations; admins can turn it off", async () => {
  await api
    .put("/api/admin/settings/maintenance")
    .set(headers(adminToken))
    .send({ maintenanceMode: true, maintenanceMessage: "Testing maintenance" })
    .expect(200);
  await api
    .post("/api/withdrawals")
    .set(headers(userToken, "maint-withdraw"))
    .send({ amount: 1, bankDetails: bank })
    .expect(503);
  await api.get("/api/app/settings").expect(200);
  await api
    .put("/api/admin/settings/maintenance")
    .set(headers(adminToken))
    .send({ maintenanceMode: false, maintenanceMessage: "" })
    .expect(200);
});
test("registration, encrypted outbox, OTP verification, login and logout", async () => {
  await api
    .post("/api/auth/register")
    .send({
      fullName: "New User",
      email: "new@example.test",
      phoneNumber: "9999999999",
      password: "ValidPassword!",
    })
    .expect(201);
  const out = (
    await db.query(
      "SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  const payload = decrypt(out.payload_encrypted, secret);
  const otp = payload.text.match(/code is (\d{6})/)[1];
  await api
    .post("/api/auth/login")
    .send({ email: "new@example.test", password: "ValidPassword!" })
    .expect(403);
  await api
    .post("/api/auth/verify-otp")
    .send({ email: "new@example.test", otp: "000000" })
    .expect(400);
  await api
    .post("/api/auth/verify-otp")
    .send({ email: "new@example.test", otp })
    .expect(200);
  await api
    .post("/api/auth/verify-otp")
    .send({ email: "new@example.test", otp })
    .expect(400);
  const r = await api
    .post("/api/auth/login")
    .send({ email: "new@example.test", password: "ValidPassword!" })
    .expect(200);
  await api
    .post("/api/auth/logout")
    .set(headers(r.body.data.token))
    .expect(200);
  await api.get("/api/auth/me").set(headers(r.body.data.token)).expect(401);
});
test("blocking revokes sessions permanently, even after unblock", async () => {
  await api
    .patch(`/api/admin/users/${user2Id}/block`)
    .set(headers(adminToken))
    .expect(200);
  await api.get("/api/auth/me").set(headers(user2Token)).expect(401);
  await api
    .patch(`/api/admin/users/${user2Id}/unblock`)
    .set(headers(adminToken))
    .expect(200);
  await api.get("/api/auth/me").set(headers(user2Token)).expect(401);
});
test("wallet ledger reconciles and refuses edits", async () => {
  const rows = (
    await db.query(
      "SELECT w.user_id,w.balance_paise,COALESCE(sum(l.delta_paise),0) AS total FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id GROUP BY w.user_id,w.balance_paise",
    )
  ).rows;
  for (const row of rows)
    assert.equal(String(row.balance_paise), String(row.total));
  await assert.rejects(() =>
    db.query("UPDATE ledger SET description=$1", ["tampered"]),
  );
});
test("health, dashboard, CORS and error envelopes", async () => {
  await api.get("/health/ready").expect(200);
  await api.get("/api/admin/dashboard").set(headers(adminToken)).expect(200);
  await api
    .get("/api/app/settings")
    .set("Origin", "https://evil.example")
    .expect(403);
  const r = await api.get("/api/missing").expect(404);
  assert.equal(r.body.success, false);
  assert.ok(r.body.requestId);
});
test(
  "concurrent withdrawals cannot overspend on a multi-connection PostgreSQL server",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const u = await seed("user", 4);
    await api
      .post("/api/wallet/admin/adjust")
      .set(headers(adminToken, "concurrent-seed"))
      .send({
        userId: u.uid,
        amount: 100,
        type: "credit",
        description: "Concurrency setup",
      })
      .expect(200);
    const results = await Promise.all(
      ["one", "two"].map((k) =>
        api
          .post("/api/withdrawals")
          .set(headers(u.token, "concurrent-" + k))
          .send({ amount: 80, bankDetails: bank }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (await api.get("/api/wallet").set(headers(u.token))).body.data.balance,
      20,
    );
  },
);
test(
  "concurrent approvals credit once on PostgreSQL",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const r = await api
      .post("/api/deposits")
      .set(headers(userToken, "concurrent-deposit"))
      .field("planId", planId)
      .field("amount", "11")
      .field("transactionRef", "CONCURRENT-REF")
      .attach("paymentProof", proof, "p.png")
      .expect(201);
    const before = (await api.get("/api/wallet").set(headers(userToken))).body
      .data.balance;
    await Promise.all(
      ["one", "two"].map((k) =>
        api
          .put(`/api/deposits/admin/${r.body.data.id}/approve`)
          .set(headers(adminToken, "concurrent-approval-" + k))
          .send({})
          .expect(200),
      ),
    );
    assert.equal(
      (await api.get("/api/wallet").set(headers(userToken))).body.data.balance,
      before + 11,
    );
  },
);
test("idempotency stores encrypted responses, including withdrawal bank details", async () => {
  const row = (
    await db.query(
      "SELECT response FROM idempotency WHERE scope='POST/withdrawals' AND response IS NOT NULL LIMIT 1",
    )
  ).rows[0];
  assert.ok(row);
  assert.ok(!row.response.includes(bank.accountNumber));
  assert.equal(
    decrypt(row.response, secret).bankDetails.accountNumber,
    bank.accountNumber,
  );
});
test("every documented Postman request has a corresponding Express route", async () => {
  const app = createApp(db, config);
  const routes = new Set();
  for (const layer of app.router.stack) {
    if (layer.handle.stack)
      for (const route of layer.handle.stack) {
        if (route.route)
          for (const method of Object.keys(route.route.methods))
            routes.add(method.toUpperCase() + " " + route.route.path);
      }
  }
  const collection = JSON.parse(
    await readFile(
      new URL("../docs/pay.postman_collection.json", import.meta.url),
      "utf8",
    ),
  );
  let count = 0;
  for (const folder of collection.item)
    for (const item of folder.item) {
      const path = item.request.url
        .replace("{{paylocal}}", "/")
        .replace("{{verificationToken}}", ":token")
        .replace(/\{\{[^}]+\}\}/g, ":id");
      assert.ok(
        routes.has(item.request.method + " " + path),
        item.request.method + " " + path,
      );
      count++;
    }
  assert.equal(count, 71);
});
