import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type SecretMeta = {
  id: string;
  connectorId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
};

export function useSecrets(orgId: string | null) {
  return useQuery({
    queryKey: ["secrets", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ secrets: SecretMeta[] }>(`/v1/orgs/${orgId}/secrets`, { method: "GET" }, { orgScoped: true });
    },
  });
}

export function useCreateSecret(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { connectorId: string; name: string; value: string }) => {
      return apiFetchJson<unknown>(
        `/v1/orgs/${orgId}/secrets`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["secrets", orgId] });
    },
  });
}

export function useRotateSecret(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { secretId: string; value: string }) => {
      return apiFetchJson<unknown>(
        `/v1/orgs/${orgId}/secrets/${input.secretId}`,
        { method: "PUT", body: JSON.stringify({ value: input.value }) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["secrets", orgId] });
    },
  });
}

export function useDeleteSecret(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (secretId: string) => {
      return apiFetchJson<unknown>(`/v1/orgs/${orgId}/secrets/${secretId}`, { method: "DELETE" }, { orgScoped: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["secrets", orgId] });
    },
  });
}
