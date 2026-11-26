import { z } from "zod";
import { HttpError } from "@/lib/core";
import { body, route } from "@/lib/http";
import { decide } from "@/lib/payments";

export const POST = route(["aprovador", "admin"], async ({ req, user }) => {
  const d = await body(req, z.object({ ids: z.array(z.string()).max(200) }));
  const approved: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const id of d.ids) {
    try {
      await decide(user, id, true);
      approved.push(id);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      errors.push({ id, error: e.detail });
    }
  }
  return { approved, errors };
});
