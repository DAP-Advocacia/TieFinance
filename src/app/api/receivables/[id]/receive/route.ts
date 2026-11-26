import { z } from "zod";
import { body, route } from "@/lib/http";
import { receiveManual } from "@/lib/receivables";

export const POST = route<{ id: string }>(["financeiro", "admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ received_date: z.string().nullish(), ref: z.string().nullish() }));
  await receiveManual(user, params.id, d.received_date || undefined, d.ref || undefined);
  return { ok: true };
});
