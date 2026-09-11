import { readdir, readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { hash } from "../src/core.js";
const db = createDb(loadConfig().databaseUrl);
try {
  await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73120498)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      );
      const old = (
        await c.query("SELECT checksum FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rows[0];
      if (old) {
        if (old.checksum !== hash(sql))
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash(sql)],
      );
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await db.close();
}
