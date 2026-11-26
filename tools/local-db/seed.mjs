// Cria os usuarios demo pela API e executa tools/seed-demo.sql no Postgres local.
// Uso: BASE_URL=http://127.0.0.1:3300 ADMIN_EMAIL=... ADMIN_PASSWORD=... DATABASE_URL=... node seed.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const r = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
if (!r.ok) throw new Error("login admin falhou: " + r.status);
const cookie = r.headers.get("set-cookie").split(";")[0];
for (const [name, email, role] of [["Mariana (demo)", "demo-mariana@demo.local", "financeiro"], ["Dr. Bruno (demo)", "demo-bruno@demo.local", "aprovador"]]) {
  const u = await fetch(base + "/api/users", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name, email, password: "DemoLocal#2026x", role }) });
  console.log(email, u.status);
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(readFileSync(join(here, "..", "seed-demo.sql"), "utf8"));
const n = await c.query("select count(*)::int n from payments where description like '[DEMO]%'");
console.log("pagamentos demo:", n.rows[0].n);
await c.end();
