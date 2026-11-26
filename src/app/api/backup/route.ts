import { zipSync, strToU8 } from "fflate";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { todaySP } from "@/lib/core";
import { route } from "@/lib/http";

function toCsv(cols: string[], rows: unknown[][]): Uint8Array {
  const esc = (v: unknown) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return strToU8("﻿" + [cols, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n");
}

/** Exportacao (zip): CSV de cada tabela (sem senhas nem sessoes) + anexos. O backup real e o do Supabase. */
export const GET = route(["admin"], async ({ user }) => {
  const db = getDb();
  const S = schema;
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, cols: string[], rows: unknown[][]) => (files[`${name}.csv`] = toCsv(cols, rows));

  add("companies", ["id", "name", "cnpj", "active"], (await db.select().from(S.companies)).map((r) => [r.id, r.name, r.cnpj, r.active]));
  add("payees", ["id", "name", "document", "payment_info", "active"], (await db.select().from(S.payees)).map((r) => [r.id, r.name, r.document, r.paymentInfo, r.active]));
  add("users", ["id", "name", "email", "role", "active"], (await db.select().from(S.users)).map((r) => [r.id, r.name, r.email, r.role, r.active]));
  add(
    "payments",
    ["id", "company_id", "payee_id", "description", "amount_cents", "pay_date", "cost_center", "status", "attachment", "attachment_name", "created_by", "created_at", "decided_by", "decided_at", "reason", "paid_date", "paid_via", "paid_ref"],
    (await db.select().from(S.payments)).map((r) => [r.id, r.companyId, r.payeeId, r.description, r.amountCents, r.payDate, r.costCenter, r.status, r.attachment, r.attachmentName, r.createdBy, r.createdAt, r.decidedBy, r.decidedAt, r.reason, r.paidDate, r.paidVia, r.paidRef]),
  );
  add("audit", ["id", "ts", "actor_id", "actor", "action", "entity", "entity_id", "detail"], (await db.select().from(S.audit)).map((r) => [r.id, r.ts, r.actorId, r.actor, r.action, r.entity, r.entityId, r.detail]));
  for (const a of await db.select().from(S.attachments)) files[`anexos/${a.id}`] = new Uint8Array(a.data);

  await log(db, user, "backup.download");
  return new Response(new Uint8Array(zipSync(files)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="exportacao-${todaySP()}.zip"` },
  });
});
