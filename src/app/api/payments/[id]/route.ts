import { HttpError } from "@/lib/core";
import { route } from "@/lib/http";
import { editPayment, readForm } from "@/lib/payments";

export const PUT = route<{ id: string }>(["financeiro", "admin"], async ({ req, user, params }) => {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(422, "Formulario invalido");
  }
  await editPayment(user, params.id, readForm(fd));
  return { ok: true };
});
