import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { clearCookie, sha, tokenFromRequest } from "@/lib/auth";
import { log } from "@/lib/audit";
import { json, route } from "@/lib/http";

export const POST = route("any", async ({ req, user }) => {
  const db = getDb();
  const token = tokenFromRequest(req);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha(token)));
  await log(db, user, "logout");
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(req) });
});
