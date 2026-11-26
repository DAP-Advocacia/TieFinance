import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError, newId } from "@/lib/core";
import { body, route } from "@/lib/http";
import type { PayeeDTO } from "@/lib/types";

const { payees } = schema;

export const GET = route("any", async () => {
  const rows = await getDb().select().from(payees).orderBy(asc(payees.name));
  return rows.map((p): PayeeDTO => ({ id: p.id, name: p.name, document: p.document, payment_info: p.paymentInfo, active: p.active }));
});

export const POST = route(["financeiro", "admin"], async ({ req, user }) => {
  const d = await body(req, z.object({ name: z.string(), document: z.string().default(""), payment_info: z.string().default("") }));
  if (!d.name.trim()) throw new HttpError(422, "Nome obrigatorio");
  const id = newId();
  await getDb().transaction(async (tx) => {
    await tx.insert(payees).values({ id, name: d.name.trim().slice(0, 160), document: d.document.trim().slice(0, 20), paymentInfo: d.payment_info.trim().slice(0, 300), active: true });
    await log(tx, user, "payee.create", "payee", id, { name: d.name.trim() });
  });
  return { id };
});
