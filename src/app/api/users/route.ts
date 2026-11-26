import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { hashPassword } from "@/lib/auth";
import { log } from "@/lib/audit";
import { HttpError, ROLES, newId } from "@/lib/core";
import { body, route } from "@/lib/http";

const { users } = schema;

export const GET = route(["admin"], async () => {
  const rows = await getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).orderBy(asc(users.name));
  return rows;
});

export const POST = route(["admin"], async ({ req, user }) => {
  const d = await body(req, z.object({ name: z.string(), email: z.string(), password: z.string(), role: z.string() }));
  const email = d.email.trim().toLowerCase();
  if (!(ROLES as readonly string[]).includes(d.role)) throw new HttpError(422, "Perfil invalido");
  if (d.password.length < 12) throw new HttpError(422, "Senha com pelo menos 12 caracteres");
  if (!d.name.trim()) throw new HttpError(422, "Nome obrigatorio");
  const hash = await hashPassword(d.password);
  const id = newId();
  await getDb().transaction(async (tx) => {
    const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!email.includes("@") || dup) throw new HttpError(409, "E-mail invalido ou ja cadastrado");
    await tx.insert(users).values({ id, name: d.name.trim(), email, password: hash, role: d.role, active: true });
    await log(tx, user, "user.create", "user", id, { email, role: d.role });
  });
  return { id };
});
