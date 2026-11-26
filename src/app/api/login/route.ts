import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { bootstrapAdmin, checkPassword, createSession, sessionCookie } from "@/lib/auth";
import { log } from "@/lib/audit";
import { HttpError, nowUtc } from "@/lib/core";
import { body, json, publicRoute } from "@/lib/http";

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export const POST = publicRoute(async (req) => {
  const { email: rawEmail, password } = await body(req, z.object({ email: z.string(), password: z.string() }));
  const email = rawEmail.trim().toLowerCase();
  const db = getDb();
  const { users, loginAttempts } = schema;
  const since = new Date(Date.now() - WINDOW_MS).toISOString().replace("T", " ").replace("Z", "");

  const [{ n }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.ts, since)));
  if (n >= MAX_FAILS) throw new HttpError(429, "Muitas tentativas. Aguarde 15 minutos.");

  if (email === (process.env.ERP_ADMIN_EMAIL ?? "").trim().toLowerCase()) await bootstrapAdmin(db);

  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u || !u.active || !(await checkPassword(password, u.password))) {
    await db.insert(loginAttempts).values({ email, ts: nowUtc() });
    await log(db, null, "login.fail", "user", "", { email });
    throw new HttpError(401, "Credenciais invalidas");
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  const token = await createSession(db, u.id);
  await log(db, u, "login");
  return json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } }, 200, { "Set-Cookie": sessionCookie(token, req) });
});
