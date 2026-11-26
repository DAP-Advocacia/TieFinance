import { z } from "zod";
import { body, route } from "@/lib/http";
import { cancelPayment } from "@/lib/payments";

export const POST = route<{ id: string }>(["financeiro", "admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ reason: z.string().default("") }));
  await cancelPayment(user, params.id, d.reason);
  return { ok: true };
});
