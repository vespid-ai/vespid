import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type AgentMeta = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt?: string | null;
  tags?: string[];
  reportedTags?: string[];
};

export type AgentInstallerMetadata = {
  provider: "npm-registry";
  delivery: "npm" | "local-dev";
  fallbackReason: string | null;
  packageName: string;
  distTag: string;
  registryUrl: string;
  docsUrl: string | null;
  commands: {
    connect: string;
    start: string;
  };
};

const DEFAULT_INSTALLER_CONNECT_COMMAND =
  'pnpm --filter @vespid/node-agent dev -- connect --pairing-token "<pairing-token>" --api-base "<api-base>"';
const DEFAULT_INSTALLER_START_COMMAND = "pnpm --filter @vespid/node-agent dev -- start";

function normalizeAgentInstallerMetadata(payload: unknown): AgentInstallerMetadata {
  const asRecord =
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const commandsRaw =
    asRecord.commands && typeof asRecord.commands === "object" && !Array.isArray(asRecord.commands)
      ? (asRecord.commands as Record<string, unknown>)
      : {};
  const connect =
    typeof commandsRaw.connect === "string" && commandsRaw.connect.trim().length > 0
      ? commandsRaw.connect
      : DEFAULT_INSTALLER_CONNECT_COMMAND;
  const start =
    typeof commandsRaw.start === "string" && commandsRaw.start.trim().length > 0
      ? commandsRaw.start
      : DEFAULT_INSTALLER_START_COMMAND;
  return {
    provider: "npm-registry",
    delivery: asRecord.delivery === "local-dev" ? "local-dev" : "npm",
    fallbackReason: typeof asRecord.fallbackReason === "string" && asRecord.fallbackReason.trim().length > 0 ? asRecord.fallbackReason : null,
    packageName: typeof asRecord.packageName === "string" && asRecord.packageName.trim().length > 0 ? asRecord.packageName : "@vespid/node-agent",
    distTag: typeof asRecord.distTag === "string" && asRecord.distTag.trim().length > 0 ? asRecord.distTag : "latest",
    registryUrl:
      typeof asRecord.registryUrl === "string" && asRecord.registryUrl.trim().length > 0
        ? asRecord.registryUrl
        : "https://registry.npmjs.org",
    docsUrl: typeof asRecord.docsUrl === "string" && asRecord.docsUrl.trim().length > 0 ? asRecord.docsUrl : null,
    commands: { connect, start },
  };
}

export function useAgentInstaller() {
  return useQuery({
    queryKey: ["agentInstaller"],
    queryFn: async () => {
      const payload = await apiFetchJson<unknown>("/v1/meta/agent-installer", { method: "GET" });
      return normalizeAgentInstallerMetadata(payload);
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAgents(orgId: string | null) {
  return useQuery({
    queryKey: ["agents", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const payload = await apiFetchJson<{
        agents?: AgentMeta[];
        executors?: Array<
          Omit<AgentMeta, "tags" | "reportedTags"> & {
            labels?: string[];
            reportedLabels?: string[];
          }
        >;
      }>(`/v1/orgs/${orgId}/agents`, { method: "GET" }, { orgScoped: true });
      if (Array.isArray(payload.agents)) {
        return { agents: payload.agents };
      }
      const executors = Array.isArray(payload.executors) ? payload.executors : [];
      return {
        agents: executors.map((executor) => ({
          ...executor,
          tags: Array.isArray(executor.labels) ? executor.labels : [],
          reportedTags: Array.isArray(executor.reportedLabels) ? executor.reportedLabels : [],
        })),
      };
    },
  });
}

export function useCreatePairingToken(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiFetchJson<{ token: string; expiresAt: string }>(
        `/v1/orgs/${orgId}/agents/pairing-tokens`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents", orgId] });
    },
  });
}

export function useRevokeAgent(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string) => {
      return apiFetchJson<unknown>(`/v1/orgs/${orgId}/agents/${agentId}/revoke`, { method: "POST" }, { orgScoped: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents", orgId] });
    },
  });
}

export function useDeleteAgent(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string) => {
      return apiFetchJson<unknown>(`/v1/orgs/${orgId}/agents/${agentId}`, { method: "DELETE" }, { orgScoped: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents", orgId] });
    },
  });
}

export function useUpdateAgentTags(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { agentId: string; tags: string[] }) => {
      return apiFetchJson<{ ok: true; agent: { id: string; tags: string[] } }>(
        `/v1/orgs/${orgId}/agents/${input.agentId}/tags`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tags: input.tags }),
        },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents", orgId] });
    },
  });
}
