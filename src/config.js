import "dotenv/config";
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 5003),
    databaseUrl: env.DATABASE_URL,
    secret: env.APP_SECRET,
    origins: (env.CORS_ORIGINS || "http://localhost:3000").split(","),
    publicUrl: env.PUBLIC_API_URL || "http://localhost:5003",
    production: env.NODE_ENV === "production",
    trustProxy: Number(env.TRUST_PROXY_HOPS || 0),
  };
  if (!config.databaseUrl) throw new Error("DATABASE_URL required");
  if (!config.secret || config.secret.length < 48)
    throw new Error("APP_SECRET must contain at least 48 random characters");
  if (
    config.production &&
    (!config.publicUrl.startsWith("https://") ||
      config.origins.some((o) => !o.startsWith("https://")))
  )
    throw new Error("Production API and frontend origins must use HTTPS");
  return config;
}
