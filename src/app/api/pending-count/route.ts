import { route } from "@/lib/http";
import { pendingForMe } from "@/lib/dashboard";

export const GET = route("any", async ({ user }) => ({ n: await pendingForMe(user) }));
