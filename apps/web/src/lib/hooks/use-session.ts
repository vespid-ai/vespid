import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "../api";
import { markApiReachable, markApiUnreachable } from "../api-reachability";
import { getLocaleFromPathname } from "../../i18n/pathnames";

export type SessionResponse = {
  session?: { token: string; expiresAt: number };
  user?: { id: string; email: string };
};

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionResponse | null> => {
      const base = getApiBase();
      const locale =
        typeof window === "undefined" ? "en" : getLocaleFromPathname(window.location?.pathname ?? "/en");
      const url = `/${locale}/api/session`;
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", credentials: "include" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markApiUnreachable(base, message);
        return null;
      }

      const text = await response.text();
      let payload: any = null;
      if (text.length) {
        try {
          payload = JSON.parse(text) as any;
        } catch {
          payload = { code: "INVALID_JSON", message: "Invalid JSON from /api/session." };
        }
      }

      if (!response.ok) {
        // Keep the shell resilient: session failures should not crash the app.
        if (response.status === 503 && payload?.code && typeof payload?.message === "string") {
          markApiUnreachable(payload?.base ?? base, payload.message);
          return null;
        }
        return null;
      }

      markApiReachable(base);
      if (!payload?.session) {
        return null;
      }
      return payload as SessionResponse;
    },
    staleTime: 60_000,
    retry: 0,
  });
}
