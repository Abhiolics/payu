import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createApp } from "./app.js";
const config = loadConfig(),
  db = createDb(config.databaseUrl);
await db.query("SELECT 1 FROM settings");
const server = createApp(db, config).listen(config.port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "listening", port: config.port })),
);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
