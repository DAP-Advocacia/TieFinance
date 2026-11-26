import { and, desc, eq, ilike, like } from "drizzle-orm";
import { schema, type Db, type Tx } from "@/db";
import { nowUtc, toIso } from "./core";
import type { SessionUser } from "./auth";
import type { AuditDTO } from "./types";

/** Registra evento de auditoria (use dentro da mesma transacao da operacao). */
export async function log(db: Db | Tx, user: Pick<SessionUser, "id" | "email"> | null, action: string, entity = "", entityId = "", detail?: unknown) {
  await db.insert(schema.audit).values({
    ts: nowUtc(),
    actorId: user?.id ?? null,
    actor: user?.email ?? "-",
    action,
    entity,
    entityId,
    detail: detail === undefined ? "" : JSON.stringify(detail),
  });
}

const dto = (a: typeof schema.audit.$inferSelect): AuditDTO => ({
  id: a.id,
  ts: toIso(a.ts),
  actor: a.actor,
  action: a.action,
  entity: a.entity,
  entity_id: a.entityId,
  detail: a.detail,
});

export async function listAudit(db: Db | Tx, f: { action?: string; actor?: string; entity_id?: string; limit?: number } = {}): Promise<AuditDTO[]> {
  const A = schema.audit;
  const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select()
    .from(A)
    .where(and(f.action ? like(A.action, `${esc(f.action)}%`) : undefined, f.actor ? ilike(A.actor, `%${esc(f.actor)}%`) : undefined, f.entity_id ? eq(A.entityId, f.entity_id) : undefined))
    .orderBy(desc(A.id))
    .limit(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  return rows.map(dto);
}
