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

export type AgentInstallerArtifact = {
  platformId: "darwin-arm64" | "linux-x64" | "windows-x64";
  os: "darwin" | "linux" | "windows";
  arch: "arm64" | "x64";
  fileName: string;
  archiveType: "tar.gz" | "zip";
  downloadUrl: string;
};

export type AgentInstallerMetadata = {
  provider: "github-releases";
  repository: string;
  channel: string;
  docsUrl: string | null;
  artifacts: AgentInstallerArtifact[];
  checksumsUrl: string;
};

export function useAgentInstaller() {
  return useQuery({
    queryKey: ["agentInstaller"],
    queryFn: async () => {
      return apiFetchJson<AgentInstallerMetadata>("/v1/meta/agent-installer", { method: "GET" });
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
      return apiFetchJson<{ agents: AgentMeta[] }>(`/v1/orgs/${orgId}/agents`, { method: "GET" }, { orgScoped: true });
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
