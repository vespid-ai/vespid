import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetchJson } from "../api";

export type SessionResponse = {
  session?: { token: string; expiresAt: number };
  user?: { id: string; email: string };
};

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionResponse | null> => {
      try {
        const payload = await apiFetchJson<SessionResponse>("/v1/auth/refresh", { method: "POST" });
        if (!payload?.session) {
          return null;
        }
        return payload;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          return null;
        }
        // If the API is down or blocked by CORS, treat as anonymous to avoid
        // taking down the shell during local dev.
        if (err instanceof ApiError && err.status === 503 && err.payload?.code === "NETWORK_ERROR") {
          return null;
        }
        throw err;
      }
    },
    staleTime: 60_000,
    retry: 0,
  });
}
