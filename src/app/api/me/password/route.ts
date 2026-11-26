import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { checkPassword, hashPassword, sha, tokenFromRequest } from "@/lib/auth";
import { log } from "@/lib/audit";
import { HttpError } from "@/lib/core";
import { body, route } from "@/lib/http";

export const POST = route("any", async ({ req, user }) => {
  const d = await body(req, z.object({ current: z.string(), new: z.string() }));
  const db = getDb();
  const [row] = await db.select({ password: schema.users.password }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await checkPassword(d.current, row.password))) throw new HttpError(403, "Senha atual incorreta");
  if (d.new.length < 12) throw new HttpError(422, "Nova senha com pelo menos 12 caracteres");
  const hash = await hashPassword(d.new);
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ password: hash }).where(eq(schema.users.id, user.id));
    // encerra as outras sessoes do usuario
    await tx.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, sha(tokenFromRequest(req) ?? ""))));
    await log(tx, user, "user.password");
  });
  return { ok: true };
});
