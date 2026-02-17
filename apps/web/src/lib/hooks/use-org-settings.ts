"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmProviderApiKind, LlmProviderId } from "@vespid/shared/llm/provider-registry";
import { apiFetchJson } from "../api";

export type OrgSettings = {
  tools: { shellRunEnabled: boolean };
  toolsets: { defaultToolsetId: string | null };
  llm?: {
    defaults?: {
      primary?: {
        provider?: LlmProviderId | null;
        model?: string | null;
        secretId?: string | null;
      };
    };
    providers?: Partial<Record<LlmProviderId, { baseUrl?: string | null; apiKind?: LlmProviderApiKind | null }>>;
  };
};

export function useOrgSettings(orgId: string | null) {
  return useQuery({
    queryKey: ["org-settings", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ settings: OrgSettings }>(`/v1/orgs/${orgId}/settings`, { method: "GET" }, { orgScoped: true });
    },
  });
}

export function useUpdateOrgSettings(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<OrgSettings>) => {
      return apiFetchJson<{ settings: OrgSettings }>(
        `/v1/orgs/${orgId}/settings`,
        { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["org-settings", orgId] });
    },
  });
}
