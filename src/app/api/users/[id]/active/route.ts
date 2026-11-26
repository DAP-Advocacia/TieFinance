import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError } from "@/lib/core";
import { body, route } from "@/lib/http";

const { users, sessions } = schema;

export const POST = route<{ id: string }>(["admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ active: z.boolean() }));
  await getDb().transaction(async (tx) => {
    const [x] = await tx.select({ id: users.id }).from(users).where(eq(users.id, params.id)).limit(1);
    if (!x) throw new HttpError(404, "Usuario nao encontrado");
    if (x.id === user.id) throw new HttpError(409, "Nao e possivel desativar a si mesmo");
    await tx.update(users).set({ active: d.active }).where(eq(users.id, x.id));
    if (!d.active) await tx.delete(sessions).where(eq(sessions.userId, x.id));
    await log(tx, user, "user.active", "user", x.id, { active: d.active });
  });
  return { ok: true };
});
