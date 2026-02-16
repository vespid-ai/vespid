"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type OrgSettings = {
  tools: { shellRunEnabled: boolean };
  toolsets: { defaultToolsetId: string | null };
  llm?: {
    defaults?: {
      session?: { provider?: "openai" | "anthropic" | "gemini" | null; model?: string | null };
      workflowAgentRun?: {
        provider?: "openai" | "anthropic" | "gemini" | "vertex" | null;
        model?: string | null;
        secretId?: string | null;
      };
      toolsetBuilder?: {
        provider?: "openai" | "anthropic" | null;
        model?: string | null;
        secretId?: string | null;
      };
    };
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
