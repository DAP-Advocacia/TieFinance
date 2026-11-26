import { z } from "zod";
import { body, route } from "@/lib/http";
import { confirmReconcile } from "@/lib/reconcile";

export const POST = route(["auditoria", "admin"], async ({ req, user }) => {
  const d = await body(
    req,
    z.object({
      items: z.array(z.object({ payment_id: z.string(), paid_date: z.string(), ref: z.string().default("") })).max(500),
      file: z.string().default(""),
    }),
  );
  return confirmReconcile(user, d.items, d.file);
});
