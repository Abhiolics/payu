import { pagination } from "./validation.js";
import { view } from "./core.js";
// Table names and SQL fragments are only supplied by server code, never request input.
export async function list(
  db,
  req,
  table,
  { where = [], params = [], searchColumns = [], secret } = {},
) {
  const q = pagination.parse(req.query),
    w = [...where],
    p = [...params];
  const add = (sql, v) => {
    p.push(v);
    w.push(sql.replace("?", `$${p.length}`));
  };
  if (q.status && ["deposits", "withdrawals", "submissions"].includes(table))
    add("status=?", q.status);
  if (
    q.userId &&
    req.user?.role === "admin" &&
    ["deposits", "withdrawals", "submissions", "ledger"].includes(table)
  )
    add("user_id=?", q.userId);
  if (q.from) add("created_at>=?::timestamptz", q.from);
  if (q.to) add("created_at<=?::timestamptz", q.to);
  if (q.search && searchColumns.length) {
    p.push(`%${q.search}%`);
    w.push(
      "(" +
        searchColumns.map((col) => `${col} ILIKE $${p.length}`).join(" OR ") +
        ")",
    );
  }
  const clause = w.length ? " WHERE " + w.join(" AND ") : "";
  const total = Number(
    (await db.query(`SELECT count(*) FROM ${table}${clause}`, p)).rows[0].count,
  );
  p.push(q.limit, (q.page - 1) * q.limit);
  const rows = (
    await db.query(
      `SELECT * FROM ${table}${clause} ORDER BY created_at DESC,id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
    )
  ).rows;
  return {
    items: rows.map((row) => view(row, secret)),
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.ceil(total / q.limit),
    },
  };
}
