import { z } from "zod";
import { body, route } from "@/lib/http";
import { payManual } from "@/lib/payments";

export const POST = route<{ id: string }>(["financeiro", "admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ paid_date: z.string().nullish() }));
  await payManual(user, params.id, d.paid_date || undefined);
  return { ok: true };
});
