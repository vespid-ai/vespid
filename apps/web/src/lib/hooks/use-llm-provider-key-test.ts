import { useMutation } from "@tanstack/react-query";
import type { LlmProviderApiKind, LlmProviderId } from "@vespid/shared/llm/provider-registry";
import { apiFetchJson } from "../api";

export type LlmProviderKeyTestResult = {
  valid: true;
  provider: LlmProviderId;
  apiKind: LlmProviderApiKind;
  checkedAt: string;
};

export function useTestLlmProviderApiKey(orgId: string | null) {
  return useMutation({
    mutationFn: async (input: { providerId: LlmProviderId; value: string; model?: string }) => {
      return apiFetchJson<LlmProviderKeyTestResult>(
        `/v1/orgs/${orgId}/llm/providers/${input.providerId}/test-key`,
        {
          method: "POST",
          body: JSON.stringify({
            value: input.value,
            ...(input.model ? { model: input.model } : {}),
          }),
        },
        { orgScoped: true }
      );
    },
  });
}
