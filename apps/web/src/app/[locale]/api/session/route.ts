import { refreshAuthSession } from "../../../../lib/server/refresh-auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return refreshAuthSession(request);
}

