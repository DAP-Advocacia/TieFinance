import { z } from "zod";
import { getDb } from "@/db";
import { body, route } from "@/lib/http";
import { createCustomer, listCustomers } from "@/lib/receivables";

export const GET = route("any", async () => listCustomers(getDb()));

export const POST = route(["financeiro", "admin"], async ({ req, user }) => {
  const d = await body(req, z.object({ name: z.string(), document: z.string().default(""), contact: z.string().default("") }));
  return { id: await createCustomer(user, d) };
});
