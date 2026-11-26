import { getDb } from "@/db";
import { HttpError } from "@/lib/core";
import { route } from "@/lib/http";
import { createPayment, listPayments, readForm } from "@/lib/payments";

export const GET = route("any", async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  return listPayments(getDb(), {
    status: sp.get("status") ?? "",
    company_id: sp.get("company_id") ?? "",
    q: sp.get("q") ?? "",
    date_from: sp.get("date_from") ?? "",
    date_to: sp.get("date_to") ?? "",
  });
});

export const POST = route(["financeiro", "admin"], async ({ req, user }) => {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(422, "Formulario invalido");
  }
  return { id: await createPayment(user, readForm(fd)) };
});
