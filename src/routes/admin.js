import { z, text } from "../validation.js";
import { ok, view, one, fail, audit } from "../core.js";
import { list } from "../list.js";
export function adminRoutes(r, db, auth, admin) {
  r.get("/admin/users", auth, admin, async (req, res) =>
    ok(
      res,
      await list(db, req, "users", {
        searchColumns: ["full_name", "email", "phone_number"],
      }),
    ),
  );
  r.get("/admin/users/:id", auth, admin, async (req, res) => {
    const u = await one(db, "SELECT * FROM users WHERE id=$1", [req.params.id]);
    const w = await one(db, "SELECT * FROM wallets WHERE user_id=$1", [u.id]);
    ok(res, { ...view(u), wallet: view(w) });
  });
  for (const [action, column, value] of [
    ["block", "is_blocked", true],
    ["unblock", "is_blocked", false],
    ["activate", "is_active", true],
    ["deactivate", "is_active", false],
  ])
    r.patch(`/admin/users/:id/${action}`, auth, admin, async (req, res) => {
      const row = await db.tx(async (c) => {
        const u = await one(c, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ]);
        if (u.role === "admin")
          fail(
            403,
            "ADMIN_PROTECTED",
            "Admin accounts cannot be changed through user controls",
          );
        const updated = await one(
          c,
          `UPDATE users SET ${column}=$2,updated_at=now() WHERE id=$1 RETURNING *`,
          [u.id, value],
        );
        if (action === "block" || action === "deactivate")
          await c.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
        await audit(c, req, `users.${action}`, u.id);
        return updated;
      });
      ok(res, view(row));
    });
  r.get("/admin/dashboard", auth, admin, async (req, res) => {
    const row = (
      await db.query(
        `SELECT (SELECT count(*) FROM users WHERE role='user') AS total_users,(SELECT count(*) FROM users WHERE role='user' AND is_active AND NOT is_blocked) AS active_users,(SELECT count(*) FROM deposits WHERE status='pending') AS pending_deposits,(SELECT count(*) FROM withdrawals WHERE status='pending') AS pending_withdrawals,(SELECT count(*) FROM submissions WHERE status='pending') AS pending_submissions,(SELECT COALESCE(sum(amount_paise),0) FROM deposits WHERE status='approved') AS approved_deposit_paise,(SELECT COALESCE(sum(amount_paise),0) FROM withdrawals WHERE status='approved') AS paid_withdrawal_paise,(SELECT COALESCE(sum(balance_paise),0) FROM wallets) AS total_wallet_paise`,
      )
    ).rows[0];
    ok(
      res,
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          Number(v),
        ]),
      ),
    );
  });
  r.get("/admin/audit-logs", auth, admin, async (req, res) =>
    ok(res, await list(db, req, "audit_logs")),
  );
  const getSettings = async () =>
    (await one(db, "SELECT data FROM settings WHERE id=1")).data;
  r.get("/app/settings", async (req, res) => {
    const {
      maintenanceMode,
      maintenanceMessage,
      forceUpdate,
      updateMessage,
      currentVersion,
    } = await getSettings();
    ok(res, {
      maintenanceMode,
      maintenanceMessage,
      forceUpdate,
      updateMessage,
      currentVersion,
    });
  });
  r.get("/payment-methods", async (req, res) => {
    const { qrCode, bankAccount } = await getSettings();
    ok(res, {
      qrCode: qrCode.enabled ? qrCode : { enabled: false },
      bankAccount: bankAccount.enabled ? bankAccount : { enabled: false },
    });
  });
  r.get("/admin/settings", auth, admin, async (req, res) =>
    ok(res, await getSettings()),
  );
  const schemas = {
    maintenance: z.strictObject({
      maintenanceMode: z.boolean(),
      maintenanceMessage: z.string().max(1000),
    }),
    "update-control": z.strictObject({
      forceUpdate: z.boolean(),
      updateMessage: z.string().max(1000),
      currentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    }),
    payment: z.strictObject({
      qrCode: z
        .strictObject({
          enabled: z.boolean(),
          imageUrl: z.union([z.url().startsWith("https://"), z.literal("")]),
        })
        .refine(
          (q) => !q.enabled || q.imageUrl.length > 0,
          "Enabled QR requires an image URL",
        ),
      bankAccount: z
        .strictObject({
          enabled: z.boolean(),
          accountHolder: z.string().max(150),
          bankName: z.string().max(150),
          accountNumber: z.string().max(24),
          ifscCode: z.string().max(11),
          upiId: z.string().max(150),
        })
        .refine(
          (b) =>
            !b.enabled ||
            (/^\d{6,24}$/.test(b.accountNumber) &&
              /^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifscCode) &&
              b.accountHolder &&
              b.bankName),
          "Enabled bank method requires valid bank details",
        ),
    }),
  };
  for (const [path, schema] of Object.entries(schemas))
    r.put(`/admin/settings/${path}`, auth, admin, async (req, res) => {
      const b = schema.parse(req.body);
      const data = await db.tx(async (c) => {
        const row = await one(
          c,
          "UPDATE settings SET data=data || $1::jsonb,updated_at=now() WHERE id=1 RETURNING data",
          [JSON.stringify(b)],
        );
        await audit(c, req, `settings.${path}`, "1");
        return row.data;
      });
      ok(res, data);
    });
  r.get("/notifications", auth, async (req, res) =>
    ok(
      res,
      await list(db, req, "notifications", {
        where: ["user_id=$1"],
        params: [req.user.id],
      }),
    ),
  );
  r.get("/notifications/unread-count", auth, async (req, res) =>
    ok(res, {
      count: Number(
        (
          await db.query(
            "SELECT count(*) FROM notifications WHERE user_id=$1 AND NOT is_read",
            [req.user.id],
          )
        ).rows[0].count,
      ),
    }),
  );
  r.patch("/notifications/read-all", auth, async (req, res) => {
    await db.query(
      "UPDATE notifications SET is_read=true WHERE user_id=$1 AND NOT is_read",
      [req.user.id],
    );
    ok(res, { message: "All notifications marked read" });
  });
  r.patch("/notifications/:id/read", auth, async (req, res) =>
    ok(
      res,
      view(
        await one(
          db,
          "UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2 RETURNING *",
          [req.params.id, req.user.id],
        ),
      ),
    ),
  );
}
