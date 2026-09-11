import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
const db = createDb(loadConfig().databaseUrl);
try {
  const rows = (
    await db.query(
      "SELECT w.user_id,w.balance_paise,COALESCE(sum(l.delta_paise),0) AS ledger_paise FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id GROUP BY w.user_id,w.balance_paise HAVING w.balance_paise<>COALESCE(sum(l.delta_paise),0)",
    )
  ).rows;
  console.log(JSON.stringify({ matched: rows.length === 0, mismatches: rows }));
  if (rows.length) process.exitCode = 1;
} finally {
  await db.close();
}
