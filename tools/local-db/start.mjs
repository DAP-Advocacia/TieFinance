// Sobe um PostgreSQL local descartavel com o schema do TieFinance (db/schema.sql).
// Uso:  cd tools/local-db && npm install && node start.mjs
// Saida: DATABASE_URL pronta para usar. Ctrl+C encerra. Dados em tools/local-db/.pgdata (ignorado pelo git).
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, ".pgdata");
const port = Number(process.env.PGPORT ?? 54329);
if (process.argv.includes("--fresh") && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
const fresh = !existsSync(dir);

const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase("tiefinance");
  const c = pg.getPgClient("tiefinance");
  await c.connect();
  await c.query(readFileSync(join(here, "..", "..", "db", "schema.sql"), "utf8"));
  await c.end();
}
console.log(`READY postgresql://postgres:postgres@127.0.0.1:${port}/tiefinance`);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
