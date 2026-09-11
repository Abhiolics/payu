import pg from "pg";
export function createDb(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
  pool.on("error", (e) =>
    console.error(JSON.stringify({ event: "database_error", code: e.code })),
  );
  return {
    query: (sql, params) => pool.query(sql, params),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await fn(c);
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
