import { z } from "zod";
import { body, route } from "@/lib/http";
import { decide } from "@/lib/payments";

export const POST = route<{ id: string }>(["aprovador", "admin"], async ({ req, user, params }) => {
  const d = await body(req, z.object({ reason: z.string().default("") }));
  await decide(user, params.id, false, d.reason);
  return { ok: true };
});
