import { z, oid, money, bank, text, reason } from "../validation.js";
import {
  id,
  ok,
  view,
  one,
  fail,
  paise,
  encrypt,
  audit,
  notify,
  changeBalance,
  moneyOperation,
} from "../core.js";
import { upload, storeFile } from "../files.js";
import { list } from "../list.js";
export function financeRoutes(r, db, config, auth, admin) {
  for (const [path, table] of [
    ["deposits", "deposits"],
    ["withdrawals", "withdrawals"],
    ["tasks/submissions", "submissions"],
  ]) {
    const adminPath =
      table === "submissions" ? "/tasks/admin/submissions" : `/${path}/admin`;
    r.get(adminPath, auth, admin, async (req, res) =>
      ok(res, await list(db, req, table, { secret: config.secret })),
    );
    r.get("/" + path, auth, async (req, res) =>
      ok(
        res,
        await list(db, req, table, {
          where: ["user_id=$1"],
          params: [req.user.id],
          secret: config.secret,
        }),
      ),
    );
  }
  r.post("/deposits", auth, upload.single("paymentProof"), async (req, res) => {
    const b = z
      .strictObject({
        planId: oid,
        transactionRef: text.max(150).transform((s) => s.toUpperCase()),
        amount: money,
      })
      .parse(req.body);
    const result = await moneyOperation(db, req, async (c) => {
      await one(
        c,
        "SELECT id FROM plans WHERE id=$1 AND is_active AND deleted_at IS NULL FOR SHARE",
        [b.planId],
        "Selected plan is unavailable",
      );
      const fileId = await storeFile(c, req);
      const row = (
        await c.query(
          "INSERT INTO deposits(id,user_id,plan_id,amount_paise,transaction_ref,proof_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            id(),
            req.user.id,
            b.planId,
            paise(b.amount),
            b.transactionRef,
            fileId,
          ],
        )
      ).rows[0];
      await audit(c, req, "deposits.created", row.id);
      return view(row);
    });
    ok(res, result, 201);
  });
  r.post("/withdrawals", auth, async (req, res) => {
    const b = z
      .strictObject({ amount: money, bankDetails: bank })
      .parse(req.body);
    const result = await moneyOperation(db, req, async (c) => {
      const wid = id(),
        amount = paise(b.amount);
      await changeBalance(
        c,
        req.user.id,
        -amount,
        `withdrawal:${wid}:reserve`,
        "Withdrawal requested; funds reserved",
        req.user.id,
      );
      const row = (
        await c.query(
          "INSERT INTO withdrawals(id,user_id,amount_paise,bank_encrypted) VALUES($1,$2,$3,$4) RETURNING *",
          [wid, req.user.id, amount, encrypt(b.bankDetails, config.secret)],
        )
      ).rows[0];
      await audit(c, req, "withdrawals.created", wid);
      return view(row, config.secret);
    });
    ok(res, result, 201);
  });
  r.post(
    "/tasks/:id/submit",
    auth,
    upload.single("proof"),
    async (req, res) => {
      z.strictObject({}).parse(req.body);
      const result = await moneyOperation(db, req, async (c) => {
        const t = await one(
          c,
          "SELECT * FROM tasks WHERE id=$1 AND is_active AND deleted_at IS NULL FOR SHARE",
          [req.params.id],
          "Task is unavailable",
        );
        const fileId = await storeFile(c, req);
        const row = (
          await c.query(
            "INSERT INTO submissions(id,user_id,task_id,proof_id,reward_paise) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [id(), req.user.id, t.id, fileId, paise(t.data.rewardAmount)],
          )
        ).rows[0];
        await audit(c, req, "submissions.created", row.id);
        return view(row);
      });
      ok(res, result, 201);
    },
  );
  for (const table of ["deposits", "withdrawals", "submissions"])
    for (const decision of ["approve", "reject"]) {
      const base =
        table === "submissions"
          ? "/tasks/admin/submissions"
          : `/${table}/admin`;
      r.put(`${base}/:id/${decision}`, auth, admin, async (req, res) => {
        const b = reason.parse(req.body || {});
        const result = await moneyOperation(db, req, async (c) => {
          const row = await one(
            c,
            `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,
            [req.params.id],
          );
          const target = decision === "approve" ? "approved" : "rejected";
          if (row.status === target) return view(row, config.secret);
          if (row.status !== "pending")
            fail(
              409,
              "ALREADY_REVIEWED",
              "This request has already been reviewed",
            );
          if (table === "withdrawals" && decision === "approve" && !b.payoutRef)
            fail(
              422,
              "PAYOUT_REFERENCE_REQUIRED",
              "Enter the bank/provider payout reference after completing the transfer",
            );
          if (decision === "reject" && !b.reason)
            fail(422, "REASON_REQUIRED", "A rejection reason is required");
          if (table === "deposits" && decision === "approve")
            await changeBalance(
              c,
              row.user_id,
              Number(row.amount_paise),
              `deposit:${row.id}:approved`,
              "Deposit approved",
              req.user.id,
            );
          if (table === "submissions" && decision === "approve")
            await changeBalance(
              c,
              row.user_id,
              Number(row.reward_paise),
              `submission:${row.id}:approved`,
              "Task reward approved",
              req.user.id,
            );
          if (table === "withdrawals" && decision === "reject")
            await changeBalance(
              c,
              row.user_id,
              Number(row.amount_paise),
              `withdrawal:${row.id}:refund`,
              "Rejected withdrawal refunded",
              req.user.id,
            );
          const updated = (
            await c.query(
              `UPDATE ${table} SET status=$2,reason=$3,reviewed_by=$4,reviewed_at=now()${table === "withdrawals" ? ",payout_ref=$5" : ""} WHERE id=$1 RETURNING *`,
              [
                row.id,
                target,
                b.reason || null,
                req.user.id,
                ...(table === "withdrawals"
                  ? [decision === "approve" ? b.payoutRef : null]
                  : []),
              ],
            )
          ).rows[0];
          await audit(c, req, `${table}.${target}`, row.id);
          await notify(
            c,
            row.user_id,
            `${table} ${target}`,
            b.reason || `Your request was ${target}.`,
          );
          return view(updated, config.secret);
        });
        ok(res, result);
      });
    }
  r.get("/wallet", auth, async (req, res) =>
    ok(
      res,
      view(
        await one(db, "SELECT * FROM wallets WHERE user_id=$1", [req.user.id]),
      ),
    ),
  );
  r.get("/wallet/transactions", auth, async (req, res) =>
    ok(
      res,
      await list(db, req, "ledger", {
        where: ["user_id=$1"],
        params: [req.user.id],
      }),
    ),
  );
  r.post("/wallet/admin/adjust", auth, admin, async (req, res) => {
    const b = z
      .strictObject({
        userId: oid,
        amount: money,
        type: z.enum(["credit", "debit"]),
        description: text.max(1000),
      })
      .parse(req.body);
    const result = await moneyOperation(db, req, async (c) => {
      await one(c, "SELECT id FROM users WHERE id=$1", [b.userId]);
      const ref = id();
      const w = await changeBalance(
        c,
        b.userId,
        paise(b.amount) * (b.type === "credit" ? 1 : -1),
        `adjustment:${ref}`,
        b.description,
        req.user.id,
      );
      await audit(c, req, `wallet.${b.type}`, b.userId);
      await notify(c, b.userId, "Wallet adjusted", b.description);
      return view(w);
    });
    ok(res, result);
  });
}
