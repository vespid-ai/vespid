import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmProviderId } from "@vespid/shared/llm/provider-registry";
import { apiFetchJson } from "../api";

export type AgentSession = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  sessionKey: string;
  scope: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer" | string;
  title: string;
  status: "active" | "archived" | string;
  pinnedExecutorId: string | null;
  pinnedExecutorPool: "managed" | "byon" | null;
  pinnedAgentId: string | null;
  routedAgentId: string | null;
  bindingId: string | null;
  executionMode: "pinned-node-host";
  executorSelector: { pool: "managed" | "byon"; labels?: string[]; group?: string; tag?: string; executorId?: string } | null;
  selectorTag: string | null;
  selectorGroup: string | null;
  engineId: string;
  toolsetId: string | null;
  llmProvider: string;
  llmModel: string;
  llmSecretId: string | null;
  toolsAllow: unknown;
  limits: unknown;
  promptSystem: string | null;
  promptInstructions: string;
  resetPolicySnapshot: unknown;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type AgentSessionEvent = {
  id: string;
  organizationId: string;
  sessionId: string;
  seq: number;
  eventType: string;
  level: "info" | "warn" | "error";
  handoffFromAgentId: string | null;
  handoffToAgentId: string | null;
  idempotencyKey: string | null;
  payload: unknown;
  createdAt: string;
};

export function useSessions(orgId: string | null) {
  return useQuery({
    queryKey: ["sessions", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ sessions: AgentSession[]; nextCursor: string | null }>(
        `/v1/orgs/${orgId}/sessions?limit=100`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useSession(orgId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: ["session", orgId, sessionId],
    enabled: Boolean(orgId && sessionId),
    queryFn: async () => {
      return apiFetchJson<{ session: AgentSession }>(
        `/v1/orgs/${orgId}/sessions/${sessionId}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useSessionEvents(orgId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: ["sessionEvents", orgId, sessionId],
    enabled: Boolean(orgId && sessionId),
    queryFn: async () => {
      return apiFetchJson<{ events: AgentSessionEvent[]; nextCursor: string | null }>(
        `/v1/orgs/${orgId}/sessions/${sessionId}/events?limit=500`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
  });
}

export function useCreateSession(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      title?: string;
      actor?: string;
      channel?: string;
      peer?: string;
      scope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
      context?: Record<string, unknown>;
      executionMode?: "pinned-node-host";
      engineId?: "gateway.loop.v2" | "gateway.codex.v2" | "gateway.claude.v2";
      toolsetId?: string;
      llm?: { provider: LlmProviderId; model: string; auth?: { secretId?: string | null } };
      prompt: { system?: string; instructions: string };
      tools: { allow: string[] };
      resetPolicy?: unknown;
      executorSelector?: { pool: "managed" | "byon"; labels?: string[]; group?: string; tag?: string; executorId?: string };
    }) => {
      return apiFetchJson<{ session: AgentSession }>(
        `/v1/orgs/${orgId}/sessions`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions", orgId] });
    },
  });
}
