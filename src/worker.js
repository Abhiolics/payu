import nodemailer from "nodemailer";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { decrypt } from "./core.js";
const config = loadConfig(),
  db = createDb(config.databaseUrl);
if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
  throw new Error("SMTP_HOST and MAIL_FROM required");
const transporter = nodemailer.createTransport({
  disableFileAccess: true,
  disableUrlAccess: true,
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  requireTLS: config.production && process.env.SMTP_SECURE !== "true",
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined,
  connectionTimeout: 10000,
  socketTimeout: 10000,
});
let stopped = false;
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await db.tx(async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM email_outbox WHERE next_attempt_at<=now() AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return;
      if (Date.now() - new Date(row.created_at).getTime() > 10 * 60 * 1000) {
        await c.query("DELETE FROM email_outbox WHERE id=$1", [row.id]);
        return;
      }
      try {
        await transporter.sendMail({
          from: process.env.MAIL_FROM,
          ...decrypt(row.payload_encrypted, config.secret),
        });
        await c.query("DELETE FROM email_outbox WHERE id=$1", [row.id]);
      } catch {
        await c.query(
          "UPDATE email_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '30 seconds' WHERE id=$1",
          [row.id],
        );
        console.error(
          JSON.stringify({ event: "mail_delivery_failed", id: row.id }),
        );
      }
    });
    await db.query(
      "DELETE FROM rate_limits WHERE reset_at<now()-interval '1 hour'",
    );
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query("DELETE FROM verification_codes WHERE expires_at<now()");
    await db.query(
      "DELETE FROM email_outbox WHERE created_at<now()-interval '10 minutes'",
    );
  } catch (e) {
    console.error(JSON.stringify({ event: "worker_error", code: e.code }));
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
transporter.close();
await db.close();
