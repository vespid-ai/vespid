import { useMutation } from "@tanstack/react-query";
import { apiFetchJson } from "../api";
import type { ToolsetCatalogItem, ToolsetDraft, ToolsetBuilderLlmConfig } from "@vespid/shared/toolset-builder";

export function useCreateToolsetBuilderSession(orgId: string | null) {
  return useMutation({
    mutationFn: async (input: { intent?: string; llm: ToolsetBuilderLlmConfig }) => {
      if (!orgId) {
        throw new Error("ORG_REQUIRED");
      }
      return apiFetchJson<{
        sessionId: string;
        status: string;
        assistant: { message: string; suggestedComponentKeys: string[] };
        components: ToolsetCatalogItem[];
        selectedComponentKeys: string[];
      }>(`/v1/orgs/${orgId}/toolsets/builder/sessions`, { method: "POST", body: JSON.stringify(input) }, { orgScoped: true });
    },
  });
}

export function useChatToolsetBuilderSession(orgId: string | null) {
  return useMutation({
    mutationFn: async (input: { sessionId: string; message: string; selectedComponentKeys: string[] }) => {
      if (!orgId) {
        throw new Error("ORG_REQUIRED");
      }
      return apiFetchJson<{
        sessionId: string;
        status: string;
        assistant: { message: string; suggestedComponentKeys: string[] };
        components: ToolsetCatalogItem[];
        selectedComponentKeys: string[];
      }>(
        `/v1/orgs/${orgId}/toolsets/builder/sessions/${input.sessionId}/chat`,
        { method: "POST", body: JSON.stringify({ message: input.message, selectedComponentKeys: input.selectedComponentKeys }) },
        { orgScoped: true }
      );
    },
  });
}

export function useFinalizeToolsetBuilderSession(orgId: string | null) {
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      name?: string;
      description?: string;
      visibility?: "private" | "org";
      selectedComponentKeys: string[];
    }) => {
      if (!orgId) {
        throw new Error("ORG_REQUIRED");
      }
      return apiFetchJson<{ draft: ToolsetDraft; warnings?: string[] }>(
        `/v1/orgs/${orgId}/toolsets/builder/sessions/${input.sessionId}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({
            name: input.name,
            description: input.description,
            visibility: input.visibility,
            selectedComponentKeys: input.selectedComponentKeys,
          }),
        },
        { orgScoped: true }
      );
    },
  });
}
