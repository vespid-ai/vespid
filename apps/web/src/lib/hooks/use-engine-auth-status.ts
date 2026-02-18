import { useQuery } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type EngineId = "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2";

export type EngineAuthStatusResponse = {
  organizationId: string;
  engines: Record<
    EngineId,
    {
      onlineExecutors: number;
      verifiedCount: number;
      unverifiedCount: number;
      executors: Array<{
        executorId: string;
        name: string;
        verified: boolean;
        checkedAt: string;
        reason: string;
      }>;
    }
  >;
};

export function useEngineAuthStatus(orgId: string | null, options?: { refetchIntervalMs?: number }) {
  return useQuery({
    queryKey: ["engine-auth-status", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<EngineAuthStatusResponse>(`/v1/orgs/${orgId}/engines/auth-status`, { method: "GET" }, { orgScoped: true });
    },
    refetchInterval: options?.refetchIntervalMs ?? 30_000,
  });
}

