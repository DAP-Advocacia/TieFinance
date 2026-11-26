import { route } from "@/lib/http";

export const GET = route("any", async ({ user }) => user);
