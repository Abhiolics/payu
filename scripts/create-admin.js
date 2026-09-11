import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { id, passwordHash } from "../src/core.js";
import { z, email, text } from "../src/validation.js";
const b = z
  .object({
    email,
    password: z.string().min(14).max(128),
    phone: z.string().regex(/^\+?[0-9]{10,15}$/),
    name: text,
  })
  .parse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    phone: process.env.ADMIN_PHONE,
    name: process.env.ADMIN_NAME || "Administrator",
  });
const db = createDb(loadConfig().databaseUrl);
try {
  const ph = await passwordHash(b.password);
  await db.tx(async (c) => {
    const uid = id();
    await c.query(
      "INSERT INTO users(id,email,full_name,phone_number,password_hash,role,is_verified) VALUES($1,$2,$3,$4,$5,'admin',true)",
      [uid, b.email, b.name, b.phone, ph],
    );
    await c.query("INSERT INTO wallets(user_id) VALUES($1)", [uid]);
  });
  console.log(
    "Administrator created. Remove ADMIN_PASSWORD from your environment.",
  );
} finally {
  await db.close();
}
