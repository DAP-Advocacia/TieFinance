import { route } from "@/lib/http";
import { receivablesSummary } from "@/lib/receivables";

export const GET = route("any", async ({ req }) => receivablesSummary(new URL(req.url).searchParams.get("company_id") ?? undefined));
