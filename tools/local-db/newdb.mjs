// Cria (ou recria) um banco vazio com o schema do TieFinance no Postgres local. Uso: node newdb.mjs nome_do_banco
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const name = process.argv[2];
if (!/^[a-z0-9_]+$/.test(name ?? "")) throw new Error("uso: node newdb.mjs nome_do_banco");
const port = process.env.PGPORT ?? 54329;
const here = dirname(fileURLToPath(import.meta.url));
const admin = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${name}`);
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();
const c = new pg.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/${name}` });
await c.connect();
await c.query(readFileSync(join(here, "..", "..", "db", "schema.sql"), "utf8"));
await c.end();
console.log(`postgresql://postgres:postgres@127.0.0.1:${port}/${name}`);
