import { z } from "zod";
import { body, route } from "@/lib/http";
import { confirmReconcile } from "@/lib/reconcile";

export const POST = route(["auditoria", "admin"], async ({ req, user }) => {
  const d = await body(
    req,
    z.object({
      items: z.array(z.object({ payment_id: z.string(), paid_date: z.string(), ref: z.string().default("") })).max(500),
      file: z.string().default(""),
      bank_account_id: z.string().min(1, "Selecione a conta bancaria"),
      file_hash: z.string().default(""),
      total_lines: z.number().default(0),
    }),
  );
  return confirmReconcile(user, d.items, d.file, d.bank_account_id, d.file_hash, d.total_lines);
});
