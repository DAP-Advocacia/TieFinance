import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connectionUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL nao definida");
  return raw.replace("postgresql+psycopg://", "postgresql://").replace("postgres+psycopg://", "postgres://");
}

const g = globalThis as unknown as { __tfSql?: ReturnType<typeof postgres> };

function client() {
  if (!g.__tfSql) {
    g.__tfSql = postgres(connectionUrl(), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false, // compativel com o pooler em modo transacao do Supabase (porta 6543)
      // search_path opcional (usado nos testes para isolar em um schema proprio)
      connection: process.env.DB_SCHEMA ? { search_path: process.env.DB_SCHEMA } : undefined,
    });
  }
  return g.__tfSql;
}

let _db: ReturnType<typeof make> | undefined;
function make() {
  return drizzle(client(), { schema });
}

export function getDb() {
  return (_db ??= make());
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
