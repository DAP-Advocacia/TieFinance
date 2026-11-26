import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError } from "@/lib/core";
import { body, route } from "@/lib/http";

export const POST = route<{ id: string }>(["admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ active: z.boolean() }));
  await getDb().transaction(async (tx) => {
    const rows = await tx.update(schema.bankAccounts).set({ active: d.active }).where(eq(schema.bankAccounts.id, params.id)).returning({ id: schema.bankAccounts.id });
    if (!rows.length) throw new HttpError(404, "Conta bancaria nao encontrada");
    await log(tx, user, "bank_account.active", "bank_account", params.id, { active: d.active });
  });
  return { ok: true };
});
