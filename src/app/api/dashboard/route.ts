import { getDashboard } from "@/lib/dashboard";
import { route } from "@/lib/http";

export const GET = route("any", async ({ req, user }) => {
  const companyId = new URL(req.url).searchParams.get("company_id") ?? "";
  return getDashboard(user, companyId);
});
