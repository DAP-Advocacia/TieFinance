import { getDb } from "@/db";
import { listAudit } from "@/lib/audit";
import { route } from "@/lib/http";

export const GET = route(["admin", "auditoria"], async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  return listAudit(getDb(), {
    action: sp.get("action") ?? "",
    actor: sp.get("actor") ?? "",
    entity_id: sp.get("entity_id") ?? "",
    limit: Number(sp.get("limit") ?? 500) || 500,
  });
});
