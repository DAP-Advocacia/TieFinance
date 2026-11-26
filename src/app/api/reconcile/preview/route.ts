import { HttpError } from "@/lib/core";
import { route } from "@/lib/http";
import { previewStatement } from "@/lib/reconcile";

export const POST = route(["auditoria", "admin"], async ({ req, user }) => {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw new HttpError(422, "Formulario invalido");
  }
  const f = fd.get("file");
  if (!(f instanceof File)) throw new HttpError(422, "Envie o arquivo do extrato");
  return previewStatement(user, f);
});
