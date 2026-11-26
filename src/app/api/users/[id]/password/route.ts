import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { hashPassword } from "@/lib/auth";
import { log } from "@/lib/audit";
import { HttpError } from "@/lib/core";
import { body, route } from "@/lib/http";

const { users, sessions } = schema;

export const POST = route<{ id: string }>(["admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ password: z.string() }));
  if (d.password.length < 12) throw new HttpError(422, "Senha com pelo menos 12 caracteres");
  const hash = await hashPassword(d.password);
  await getDb().transaction(async (tx) => {
    const [x] = await tx.select({ id: users.id }).from(users).where(eq(users.id, params.id)).limit(1);
    if (!x) throw new HttpError(404, "Usuario nao encontrado");
    await tx.update(users).set({ password: hash }).where(eq(users.id, x.id));
    await tx.delete(sessions).where(eq(sessions.userId, x.id));
    await log(tx, user, "user.password_reset", "user", x.id);
  });
  return { ok: true };
});
