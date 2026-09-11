import { randomUUID } from "node:crypto";
import { hash, fail, one } from "./core.js";
export function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.set("X-Request-Id", req.requestId);
  res.set("Cache-Control", "no-store");
  next();
}
export function authenticate(db) {
  return async (req, res, next) => {
    const token = req
      .get("Authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) fail(401, "UNAUTHENTICATED", "Sign in to continue");
    const u = (
      await db.query(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [hash(token)],
      )
    ).rows[0];
    if (!u) fail(401, "UNAUTHENTICATED", "Invalid or expired session");
    if (u.is_blocked || !u.is_active || !u.is_verified)
      fail(
        403,
        "ACCOUNT_UNAVAILABLE",
        "Account is blocked, inactive, or unverified",
      );
    req.user = u;
    req.tokenHash = hash(token);
    next();
  };
}
export function admin(req, res, next) {
  if (req.user.role !== "admin")
    fail(403, "FORBIDDEN", "Administrator access required");
  next();
}
export function rateLimit(db, max = 60, seconds = 60, keyFn = (req) => req.ip) {
  return async (req, res, next) => {
    const key = hash(req.baseUrl + ":" + req.path + ":" + keyFn(req));
    const row = await one(
      db,
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+($2::integer * interval '1 second')) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.hits+1 END,reset_at=CASE WHEN rate_limits.reset_at<=now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING *`,
      [key, seconds],
    );
    if (row.hits > max) {
      res.set("Retry-After", String(seconds));
      fail(429, "RATE_LIMITED", "Too many requests. Try again later");
    }
    next();
  };
}
export function errors(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status || 500,
    code = err.code || "INTERNAL_ERROR",
    message = err.message;
  if (err.name === "ZodError") {
    status = 422;
    code = "VALIDATION_ERROR";
    message = "Request validation failed";
  } else if (err.code === "23505") {
    status = 409;
    code = "CONFLICT";
    message = "This record or transaction already exists";
  } else if (err.code === "23503") {
    status = 422;
    code = "INVALID_REFERENCE";
    message = "Referenced record does not exist";
  } else if (err.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "Maximum upload size is 5 MiB";
  } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
    status = 422;
    message = "Unexpected upload field";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Malformed JSON";
  }
  if (status >= 500 && !err.status) {
    console.error(
      JSON.stringify({
        event: "request_error",
        requestId: req.requestId,
        code,
      }),
    );
    message = "An internal error occurred";
  }
  res
    .status(status)
    .json({
      success: false,
      error: {
        code,
        message,
        ...(err.name === "ZodError"
          ? {
              details: err.issues.map((i) => ({
                path: i.path,
                message: i.message,
              })),
            }
          : {}),
      },
      requestId: req.requestId,
    });
}
