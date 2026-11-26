import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError, newId } from "@/lib/core";
import { body, route } from "@/lib/http";

const { companies } = schema;

export const GET = route("any", async () => {
  const rows = await getDb().select().from(companies).orderBy(asc(companies.name));
  return rows;
});

export const POST = route(["admin"], async ({ req, user }) => {
  const d = await body(req, z.object({ name: z.string(), cnpj: z.string().default("") }));
  if (!d.name.trim()) throw new HttpError(422, "Nome obrigatorio");
  const id = newId();
  await getDb().transaction(async (tx) => {
    await tx.insert(companies).values({ id, name: d.name.trim().slice(0, 160), cnpj: d.cnpj.trim().slice(0, 20), active: true });
    await log(tx, user, "company.create", "company", id, { name: d.name.trim(), cnpj: d.cnpj.trim() });
  });
  return { id };
});
