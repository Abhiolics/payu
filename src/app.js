import express from "express";
import helmet from "helmet";
import cors from "cors";
import {
  requestId,
  authenticate,
  admin,
  errors,
  rateLimit,
} from "./middleware.js";
import { fail, ok } from "./core.js";
import { authRoutes } from "./routes/auth.js";
import { financeRoutes } from "./routes/finance.js";
import { catalogRoutes } from "./routes/catalog.js";
import { adminRoutes } from "./routes/admin.js";
import { fileRoutes } from "./files.js";
export function createApp(db, config) {
  const app = express();
  app.locals.encryptionSecret = config.secret;
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy || false);
  app.use(requestId, helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.origins.includes(origin)) cb(null, true);
        else
          cb(
            Object.assign(new Error("Origin not allowed"), {
              status: 403,
              code: "CORS_DENIED",
            }),
          );
      },
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.get("/health/live", (req, res) => ok(res, { status: "up" }));
  app.get("/health/ready", async (req, res) => {
    await db.query("SELECT 1 FROM settings WHERE id=1");
    ok(res, { status: "ready" });
  });
  const r = express.Router(),
    auth = authenticate(db);
  r.use(rateLimit(db, 120, 60, (req) => req.ip));
  // Public settings and authentication remain reachable while maintenance is on.
  r.use(async (req, res, next) => {
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ||
      req.path.startsWith("/auth/")
    )
      return next();
    const s = (await db.query("SELECT data FROM settings WHERE id=1")).rows[0]
      ?.data;
    if (!s?.maintenanceMode) return next();
    await auth(req, res, () => {});
    if (req.user.role !== "admin")
      fail(
        503,
        "MAINTENANCE",
        s.maintenanceMessage || "Maintenance in progress",
      );
    next();
  });
  authRoutes(r, db, config, auth);
  financeRoutes(r, db, config, auth, admin);
  catalogRoutes(r, db, auth, admin);
  adminRoutes(r, db, auth, admin);
  fileRoutes(r, db, auth);
  app.use("/api", r);
  app.use((req, res) => fail(404, "NOT_FOUND", "Endpoint not found"));
  app.use(errors);
  return app;
}
