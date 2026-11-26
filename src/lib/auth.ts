import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { and, eq, gt, count } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/db";
import { HttpError, SESSION_SECONDS, nowUtc, newId, type Role } from "./core";

export const COOKIE = "tf_session";
const { users, sessions } = schema;

export type SessionUser = { id: string; name: string; email: string; role: Role };

function scrypt(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) =>
    scryptCb(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))),
  );
}

/** Mesmo formato da versao Python: salt_hex$scrypt_hex (N=2^14, r=8, p=1, 64 bytes) */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return salt.toString("hex") + "$" + (await scrypt(pw, salt)).toString("hex");
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split("$");
    const calc = await scrypt(pw, Buffer.from(salt, "hex"));
    const want = Buffer.from(hash, "hex");
    return want.length === calc.length && timingSafeEqual(calc, want);
  } catch {
    return false;
  }
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export async function createSession(db: Db | Tx, userId: string): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({ id: sha(token), userId, expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
  return token;
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha(token)), gt(sessions.expires, Math.floor(Date.now() / 1000)), eq(users.active, true)))
    .limit(1);
  return (rows[0] as SessionUser | undefined) ?? null;
}

export function tokenFromRequest(req: Request): string | null {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string, req: Request): string {
  const secure = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (req: Request) => sessionCookie("", req).replace(/Max-Age=\d+/, "Max-Age=0");

/** Cria o admin inicial (a partir das variaveis de ambiente) se nao houver nenhum usuario. */
export async function bootstrapAdmin(db: Db): Promise<boolean> {
  const email = (process.env.ERP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const pw = process.env.ERP_ADMIN_PASSWORD ?? "";
  if (!email || pw.length < 12) return false;
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return false;
  await db.insert(users).values({ id: newId(), name: "Administrador", email, password: await hashPassword(pw), role: "admin", active: true });
  return true;
}

export function assertRole(user: SessionUser, roles: readonly Role[]) {
  if (!roles.includes(user.role)) throw new HttpError(403, "Sem permissao");
}

export async function currentServerUser(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  return userFromToken((await cookies()).get(COOKIE)?.value);
}
