import { randomBytes, randomInt } from "node:crypto";
import { z, email, text } from "../validation.js";
import {
  id,
  hash,
  digest,
  passwordHash,
  passwordMatches,
  encrypt,
  view,
  ok,
  fail,
  one,
  audit,
} from "../core.js";
import { rateLimit } from "../middleware.js";
export function authRoutes(r, db, config, auth) {
  const authLimit = rateLimit(db, 10, 900),
    emailLimit = rateLimit(db, 3, 900, (req) =>
      String(req.body.email || "")
        .trim()
        .toLowerCase(),
    );
  async function queueCode(c, user) {
    const otp = String(randomInt(100000, 1000000)),
      token = randomBytes(32).toString("hex");
    await c.query(
      `INSERT INTO verification_codes(user_id,otp_hash,link_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET otp_hash=EXCLUDED.otp_hash,link_hash=EXCLUDED.link_hash,attempts=0,expires_at=EXCLUDED.expires_at`,
      [user.id, digest(otp, config.secret), hash(token)],
    );
    await c.query(
      "INSERT INTO email_outbox(id,payload_encrypted) VALUES($1,$2)",
      [
        id(),
        encrypt(
          {
            to: user.email,
            subject: "Verify your account",
            text: `Your verification code is ${otp}. It expires in 10 minutes.\nAlternatively: ${config.publicUrl}/api/auth/verify-email/${token}`,
          },
          config.secret,
        ),
      ],
    );
  }
  r.post("/auth/register", authLimit, async (req, res) => {
    const b = z
      .strictObject({
        fullName: text.max(150),
        phoneNumber: z.string().regex(/^\+?[0-9]{10,15}$/),
        email,
        password: z.string().min(10).max(128),
      })
      .parse(req.body);
    const p = await passwordHash(b.password);
    await db.tx(async (c) => {
      const u = (
        await c.query(
          "INSERT INTO users(id,full_name,phone_number,email,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id(), b.fullName, b.phoneNumber, b.email, p],
        )
      ).rows[0];
      await c.query("INSERT INTO wallets(user_id) VALUES($1)", [u.id]);
      await queueCode(c, u);
    });
    ok(
      res,
      {
        message:
          "Registration complete. Check your email to verify your account.",
      },
      201,
    );
  });
  r.post("/auth/send-otp", authLimit, emailLimit, async (req, res) => {
    const b = z.strictObject({ email }).parse(req.body);
    await db.tx(async (c) => {
      const u = (
        await c.query(
          "SELECT * FROM users WHERE email=$1 AND NOT is_verified AND NOT is_blocked AND is_active FOR UPDATE",
          [b.email],
        )
      ).rows[0];
      if (u) await queueCode(c, u);
    });
    ok(res, {
      message:
        "If an eligible account exists, a verification email has been queued.",
    });
  });
  async function consume(where, args, otp) {
    return db.tx(async (c) => {
      const v = (
        await c.query(
          `SELECT v.* FROM verification_codes v JOIN users u ON u.id=v.user_id WHERE ${where} AND v.expires_at>now() AND v.attempts<5 AND NOT u.is_blocked AND u.is_active FOR UPDATE OF v`,
          args,
        )
      ).rows[0];
      if (!v) return false;
      if (otp && digest(otp, config.secret) !== v.otp_hash) {
        await c.query(
          "UPDATE verification_codes SET attempts=attempts+1 WHERE user_id=$1",
          [v.user_id],
        );
        return false;
      }
      await c.query(
        "UPDATE users SET is_verified=true,updated_at=now() WHERE id=$1",
        [v.user_id],
      );
      await c.query("DELETE FROM verification_codes WHERE user_id=$1", [
        v.user_id,
      ]);
      return true;
    });
  }
  r.post("/auth/verify-otp", authLimit, async (req, res) => {
    const b = z
      .strictObject({ email, otp: z.string().regex(/^\d{6}$/) })
      .parse(req.body);
    if (!(await consume("u.email=$1", [b.email], b.otp)))
      fail(
        400,
        "INVALID_CODE",
        "Invalid, expired, or exhausted verification code",
      );
    ok(res, { message: "Email verified. You can now log in." });
  });
  r.get("/auth/verify-email/:token", authLimit, async (req, res) => {
    if (
      !/^[a-f0-9]{64}$/.test(req.params.token) ||
      !(await consume("v.link_hash=$1", [hash(req.params.token)]))
    )
      fail(400, "INVALID_CODE", "Invalid or expired verification link");
    ok(res, { message: "Email verified. You can now log in." });
  });
  // Password-based login is an addition: the supplied collection has no login request.
  r.post("/auth/login", authLimit, emailLimit, async (req, res) => {
    const b = z
      .strictObject({ email, password: z.string().min(1).max(128) })
      .parse(req.body);
    const u = (await db.query("SELECT * FROM users WHERE email=$1", [b.email]))
      .rows[0];
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await passwordMatches(b.password, u?.password_hash || dummy);
    if (!u || !valid)
      fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
    if (!u.is_verified || u.is_blocked || !u.is_active)
      fail(
        403,
        "ACCOUNT_UNAVAILABLE",
        "Verify your email or contact support about your account",
      );
    const token = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",
      [hash(token), u.id],
    );
    ok(res, { token, tokenType: "Bearer", expiresIn: 86400, user: view(u) });
  });
  r.post("/auth/logout", auth, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [req.tokenHash]);
    ok(res, { message: "Logged out" });
  });
  r.get("/auth/me", auth, (req, res) => ok(res, view(req.user)));
  r.put("/auth/update-profile", auth, async (req, res) => {
    const b = z
      .strictObject({
        fullName: text.max(150).optional(),
        phoneNumber: z
          .string()
          .regex(/^\+?[0-9]{10,15}$/)
          .optional(),
      })
      .refine((b) => Object.keys(b).length > 0)
      .parse(req.body);
    const u = await one(
      db,
      "UPDATE users SET full_name=COALESCE($2,full_name),phone_number=COALESCE($3,phone_number),updated_at=now() WHERE id=$1 RETURNING *",
      [req.user.id, b.fullName || null, b.phoneNumber || null],
    );
    ok(res, view(u));
  });
  r.put("/auth/password", auth, async (req, res) => {
    const b = z
      .strictObject({
        currentPassword: z.string().max(128),
        newPassword: z.string().min(10).max(128),
      })
      .parse(req.body);
    if (!(await passwordMatches(b.currentPassword, req.user.password_hash)))
      fail(401, "INVALID_CREDENTIALS", "Incorrect current password");
    const ph = await passwordHash(b.newPassword);
    await db.tx(async (c) => {
      await c.query(
        "UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1",
        [req.user.id, ph],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
      await audit(c, req, "password.changed", req.user.id);
    });
    ok(res, { message: "Password changed. Please log in again." });
  });
}
