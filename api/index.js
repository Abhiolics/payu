import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp(db, config);

export default app;
