import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { csv, route } from "@/lib/http";

export const GET = route(["admin", "auditoria"], async ({ user }) => {
  const db = getDb();
  const all = await db.select().from(schema.audit).orderBy(asc(schema.audit.id));
  const rows: (string | number | null)[][] = [
    ["Data/hora (UTC)", "Usuario", "Acao", "Entidade", "ID", "Detalhe"],
    ...all.map((a) => [a.ts.slice(0, 19), a.actor, a.action, a.entity, a.entityId, a.detail]),
  ];
  await log(db, user, "export.audit");
  return csv(rows, "auditoria.csv");
});
