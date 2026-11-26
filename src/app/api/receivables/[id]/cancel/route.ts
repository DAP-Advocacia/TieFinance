import { z } from "zod";
import { body, route } from "@/lib/http";
import { cancelReceivable } from "@/lib/receivables";

export const POST = route<{ id: string }>(["financeiro", "admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ reason: z.string() }));
  await cancelReceivable(user, params.id, d.reason);
  return { ok: true };
});
