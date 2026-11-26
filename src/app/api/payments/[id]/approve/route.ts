import { route } from "@/lib/http";
import { decide } from "@/lib/payments";

export const POST = route<{ id: string }>(["aprovador", "admin"], async ({ user, params }) => {
  await decide(user, params.id, true);
  return { ok: true };
});
