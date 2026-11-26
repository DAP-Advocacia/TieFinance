import { z } from "zod";
import { getDb } from "@/db";
import { body, route } from "@/lib/http";
import { createReceivables, listReceivables } from "@/lib/receivables";

export const GET = route("any", async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const g = (k: string) => sp.get(k) ?? "";
  return listReceivables(getDb(), { status: g("status"), company_id: g("company_id"), customer_id: g("customer_id"), kind: g("kind"), q: g("q"), date_from: g("date_from"), date_to: g("date_to") });
});

export const POST = route(["financeiro", "admin"], async ({ req, user }) => {
  const d = await body(
    req,
    z.object({
      company_id: z.string(),
      bank_account_id: z.string(),
      customer_id: z.string(),
      kind: z.string(),
      description: z.string(),
      amount: z.string(),
      due_date: z.string(),
      installments: z.number().int().optional(),
      request_key: z.string().nullish(),
    }),
  );
  return createReceivables(user, d);
});
