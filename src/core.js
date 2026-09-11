import {
  randomBytes,
  createHash,
  createHmac,
  scrypt as scryptCb,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
export const id = () => randomBytes(12).toString("hex");
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const digest = (s, secret) =>
  createHmac("sha256", secret).update(s).digest("hex");
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password, encoded) {
  const [salt, hex] = encoded.split(":");
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(key, Buffer.from(hex, "hex"));
}
export function encrypt(data, secret) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(hash(secret), "hex"),
      iv,
    );
  const body = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt(data, secret) {
  const b = Buffer.from(data, "base64"),
    d = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(hash(secret), "hex"),
      b.subarray(0, 12),
    );
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
  );
}
export function paise(value) {
  const s = String(value);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s))
    fail(
      422,
      "INVALID_AMOUNT",
      "Amount must be positive rupees with at most two decimal places",
    );
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (n <= 0) fail(422, "INVALID_AMOUNT", "Amount must be greater than zero");
  return n;
}
export function view(row, secret) {
  if (!row) return null;
  const out = { ...(row.data || {}) };
  for (const [key, value] of Object.entries(row)) {
    if (
      [
        "data",
        "password_hash",
        "bank_encrypted",
        "deleted_at",
        "content",
      ].includes(key)
    )
      continue;
    const k = key.replace(/_([a-z])/g, (_, x) => x.toUpperCase());
    out[k] = value;
  }
  if (row.id) out._id = row.id;
  if (row.amount_paise !== undefined)
    out.amount = Number(row.amount_paise) / 100;
  if (row.reward_paise !== undefined)
    out.rewardAmount = Number(row.reward_paise) / 100;
  if (row.balance_paise !== undefined)
    out.balance = Number(row.balance_paise) / 100;
  if (row.delta_paise !== undefined) {
    out.amount = Math.abs(Number(row.delta_paise)) / 100;
    out.type = Number(row.delta_paise) > 0 ? "credit" : "debit";
  }
  if (row.balance_after_paise !== undefined)
    out.balanceAfter = Number(row.balance_after_paise) / 100;
  if (row.proof_id) out.proofUrl = `/api/files/${row.proof_id}`;
  if (row.bank_encrypted && secret)
    out.bankDetails = decrypt(row.bank_encrypted, secret);
  return out;
}
export const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });
export async function one(c, sql, args = [], message = "Resource not found") {
  const r = (await c.query(sql, args)).rows[0];
  if (!r) fail(404, "NOT_FOUND", message);
  return r;
}
export async function audit(c, req, action, entityId) {
  await c.query(
    "INSERT INTO audit_logs(id,actor_id,action,entity_id,request_id) VALUES($1,$2,$3,$4,$5)",
    [id(), req.user?.id || null, action, entityId, req.requestId],
  );
}
export async function notify(c, userId, title, message) {
  await c.query(
    "INSERT INTO notifications(id,user_id,title,message) VALUES($1,$2,$3,$4)",
    [id(), userId, title, message],
  );
}
export async function changeBalance(
  c,
  userId,
  delta,
  source,
  description,
  actor,
) {
  const w = (
    await c.query(
      "UPDATE wallets SET balance_paise=balance_paise+$2 WHERE user_id=$1 AND balance_paise+$2>=0 RETURNING *",
      [userId, delta],
    )
  ).rows[0];
  if (!w) fail(409, "INSUFFICIENT_BALANCE", "Insufficient wallet balance");
  await c.query(
    "INSERT INTO ledger(id,user_id,delta_paise,balance_after_paise,source_key,description,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id(), userId, delta, w.balance_paise, source, description, actor],
  );
  return w;
}
export async function moneyOperation(db, req, fn) {
  const key = req.get("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
    fail(
      422,
      "IDEMPOTENCY_REQUIRED",
      "Send an Idempotency-Key of 8–128 letters, digits, underscores or hyphens",
    );
  const scope = req.method + req.path;
  const fp = hash(
    JSON.stringify(req.body) + (req.file ? hash(req.file.buffer) : ""),
  );
  return db.tx(async (c) => {
    await c.query(
      "INSERT INTO idempotency(user_id,scope,key,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [req.user.id, scope, key, fp],
    );
    const record = await one(
      c,
      "SELECT * FROM idempotency WHERE user_id=$1 AND scope=$2 AND key=$3 FOR UPDATE",
      [req.user.id, scope, key],
    );
    if (record.fingerprint !== fp)
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This key was already used with a different request",
      );
    if (record.response)
      return decrypt(record.response, req.app.locals.encryptionSecret);
    const result = await fn(c);
    await c.query(
      "UPDATE idempotency SET response=$4 WHERE user_id=$1 AND scope=$2 AND key=$3",
      [
        req.user.id,
        scope,
        key,
        encrypt(result, req.app.locals.encryptionSecret),
      ],
    );
    return result;
  });
}
