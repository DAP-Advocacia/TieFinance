import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { log } from "@/lib/audit";
import { HttpError } from "@/lib/core";
import { route } from "@/lib/http";

export const GET = route<{ id: string }>("any", async ({ user, params }) => {
  const db = getDb();
  const [p] = await db
    .select({ id: schema.payments.id, attachment: schema.payments.attachment, name: schema.payments.attachmentName })
    .from(schema.payments)
    .where(eq(schema.payments.id, params.id))
    .limit(1);
  if (!p || !p.attachment) throw new HttpError(404, "Sem anexo");
  const [a] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, p.attachment)).limit(1);
  if (!a) throw new HttpError(404, "Arquivo do anexo nao encontrado");
  await log(db, user, "attachment.view", "payment", p.id);
  const ext = p.attachment.slice(p.attachment.lastIndexOf(".")).toLowerCase();
  const type = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
  const filename = encodeURIComponent(p.name ?? p.attachment);
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});
