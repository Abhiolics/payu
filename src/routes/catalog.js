import { plan, gift, task, contact, z, text } from "../validation.js";
import {
  id,
  ok,
  view,
  one,
  fail,
  audit,
  moneyOperation,
  paise,
  changeBalance,
  notify,
} from "../core.js";
import { list } from "../list.js";
export function catalogRoutes(r, db, auth, admin) {
  for (const [path, table, schema] of [
    ["plans", "plans", plan],
    ["gift-codes", "gift_codes", gift],
    ["tasks", "tasks", task],
    ["contacts", "contacts", contact],
  ]) {
    const base = path === "contacts" ? "/admin/contacts" : `/${path}/admin`;
    r.get(base, auth, admin, async (req, res) =>
      ok(
        res,
        await list(db, req, table, {
          where: ["deleted_at IS NULL"],
          searchColumns: [
            "data->>'name'",
            "data->>'title'",
            "data->>'code'",
            "data->>'label'",
          ],
        }),
      ),
    );
    r.post(base, auth, admin, async (req, res) => {
      const b = schema.parse(req.body);
      if (table === "gift_codes" && new Date(b.expiryDate) <= new Date())
        fail(422, "INVALID_EXPIRY", "Expiry must be in the future");
      const row = await db.tx(async (c) => {
        const row = (
          await c.query(
            `INSERT INTO ${table}(id,data${table === "gift_codes" ? ",code" : ""}) VALUES($1,$2${table === "gift_codes" ? ",$3" : ""}) RETURNING *`,
            [
              id(),
              JSON.stringify(b),
              ...(table === "gift_codes" ? [b.code] : []),
            ],
          )
        ).rows[0];
        await audit(c, req, `${path}.created`, row.id);
        return row;
      });
      ok(res, view(row), 201);
    });
    r.put(base + "/:id", auth, admin, async (req, res) => {
      const b = schema.parse(req.body);
      const row = await db.tx(async (c) => {
        const old = await one(
          c,
          `SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
          [req.params.id],
        );
        if (table === "gift_codes") {
          if (b.maxUsers < old.used_count)
            fail(
              422,
              "INVALID_CAPACITY",
              "maxUsers cannot be below existing redemptions",
            );
          if (b.code !== old.code && old.used_count > 0)
            fail(409, "CODE_IN_USE", "Cannot rename a redeemed code");
          if (new Date(b.expiryDate) <= new Date())
            fail(422, "INVALID_EXPIRY", "Expiry must be in the future");
        }
        const row = (
          await c.query(
            `UPDATE ${table} SET data=$2,updated_at=now()${table === "gift_codes" ? ",code=$3" : ""} WHERE id=$1 RETURNING *`,
            [
              req.params.id,
              JSON.stringify(b),
              ...(table === "gift_codes" ? [b.code] : []),
            ],
          )
        ).rows[0];
        await audit(c, req, `${path}.updated`, row.id);
        return row;
      });
      ok(res, view(row));
    });
    r.delete(base + "/:id", auth, admin, async (req, res) => {
      await db.tx(async (c) => {
        await one(
          c,
          `UPDATE ${table} SET deleted_at=now(),is_active=false,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          [req.params.id],
        );
        await audit(c, req, `${path}.deleted`, req.params.id);
      });
      ok(res, { message: "Deleted" });
    });
    r.patch(base + "/:id/toggle", auth, admin, async (req, res) => {
      const row = await db.tx(async (c) => {
        const row = await one(
          c,
          `UPDATE ${table} SET is_active=NOT is_active,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
          [req.params.id],
        );
        await audit(c, req, `${path}.toggled`, row.id);
        return row;
      });
      ok(res, view(row));
    });
    if (path !== "gift-codes")
      r.get(
        "/" + path,
        ...(path === "contacts" ? [] : [auth]),
        async (req, res) =>
          ok(
            res,
            await list(db, req, table, {
              where: ["deleted_at IS NULL", "is_active=true"],
            }),
          ),
      );
  }
  // Compatibility for the collection's incomplete /admin/:id/toggle URL.
  r.patch("/admin/:id/toggle", auth, admin, async (req, res) => {
    const row = await db.tx(async (c) => {
      const row = await one(
        c,
        "UPDATE plans SET is_active=NOT is_active,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *",
        [req.params.id],
      );
      await audit(c, req, "plans.toggled", row.id);
      return row;
    });
    ok(res, view(row));
  });
  r.post("/gift-codes/redeem", auth, async (req, res) => {
    const b = z
      .strictObject({ code: text.max(40).transform((s) => s.toUpperCase()) })
      .parse(req.body);
    const result = await moneyOperation(db, req, async (c) => {
      const g = await one(
        c,
        "SELECT * FROM gift_codes WHERE code=$1 AND deleted_at IS NULL FOR UPDATE",
        [b.code],
      );
      if (
        !g.is_active ||
        new Date(g.data.expiryDate) <= new Date() ||
        g.used_count >= g.data.maxUsers
      )
        fail(
          409,
          "GIFT_UNAVAILABLE",
          "Gift code is inactive, expired, or fully redeemed",
        );
      const rid = id(),
        amount = paise(g.data.rewardAmount);
      await c.query(
        "INSERT INTO gift_redemptions(id,user_id,gift_id,reward_paise) VALUES($1,$2,$3,$4)",
        [rid, req.user.id, g.id, amount],
      );
      await c.query(
        "UPDATE gift_codes SET used_count=used_count+1 WHERE id=$1",
        [g.id],
      );
      const wallet = await changeBalance(
        c,
        req.user.id,
        amount,
        `gift:${rid}`,
        "Gift code redeemed",
        req.user.id,
      );
      await notify(
        c,
        req.user.id,
        "Gift redeemed",
        `${b.code} credited to your wallet`,
      );
      return { redemptionId: rid, wallet: view(wallet) };
    });
    ok(res, result, 201);
  });
}
