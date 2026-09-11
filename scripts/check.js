import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(path) {
  for (const e of await readdir(path, { withFileTypes: true })) {
    const p = path + "/" + e.name;
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith(".js")) {
      const r = spawnSync(process.execPath, ["--check", p], {
        stdio: "inherit",
      });
      if (r.status) process.exit(r.status);
    }
  }
}
for (const p of ["src", "scripts", "test"]) await walk(p);
console.log("Syntax checks passed");
