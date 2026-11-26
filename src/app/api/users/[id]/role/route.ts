import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError, ROLES } from "@/lib/core";
import { body, route } from "@/lib/http";

const { users, sessions } = schema;

export const POST = route<{ id: string }>(["admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ role: z.string() }));
  if (!(ROLES as readonly string[]).includes(d.role)) throw new HttpError(422, "Perfil invalido");
  await getDb().transaction(async (tx) => {
    const [x] = await tx.select().from(users).where(eq(users.id, params.id)).limit(1);
    if (!x) throw new HttpError(404, "Usuario nao encontrado");
    if (x.id === user.id) throw new HttpError(409, "Nao e possivel alterar o proprio perfil");
    await tx.update(users).set({ role: d.role }).where(eq(users.id, x.id));
    await tx.delete(sessions).where(eq(sessions.userId, x.id)); // forca novo login com o novo perfil
    await log(tx, user, "user.role", "user", x.id, { from: x.role, to: d.role });
  });
  return { ok: true };
});
