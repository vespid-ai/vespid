import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type ChannelDefinition = {
  id: string;
  label: string;
  category: "core" | "extended" | string;
  docsPath: string;
  requiresExternalRuntime: boolean;
  defaultDmPolicy: "pairing" | "allowlist" | "open" | "disabled" | string;
  defaultRequireMentionInGroup: boolean;
  supportsWebhook: boolean;
  supportsLongPolling: boolean;
  supportsSocketMode: boolean;
};

export type ChannelAccount = {
  id: string;
  organizationId: string;
  channelId: string;
  accountKey: string;
  displayName: string | null;
  enabled: boolean;
  status: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled" | string;
  groupPolicy: "allowlist" | "open" | "disabled" | string;
  requireMentionInGroup: boolean;
  webhookUrl: string | null;
  metadata: unknown;
  lastError: string | null;
  lastSeenAt: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChannelPairingRequest = {
  id: string;
  organizationId: string;
  accountId: string;
  scope: string;
  requesterId: string;
  requesterDisplayName: string | null;
  code: string;
  status: "pending" | "approved" | "rejected" | string;
  expiresAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
};

export type ChannelEvent = {
  id: string;
  organizationId: string;
  accountId: string;
  conversationId: string | null;
  eventType: string;
  level: "info" | "warn" | "error";
  message: string | null;
  payload: unknown;
  createdAt: string;
};

export type ChannelAllowlistEntry = {
  id: string;
  organizationId: string;
  accountId: string;
  scope: string;
  subject: string;
  createdByUserId: string;
  createdAt: string;
};

export type ChannelAccountStatusPayload = {
  account: ChannelAccount;
  secretsCount: number;
  pendingPairings: number;
  allowlistCount: number;
  latestEvents: ChannelEvent[];
};

export function useChannelCatalog() {
  return useQuery({
    queryKey: ["channelCatalog"],
    queryFn: async () => {
      return apiFetchJson<{ channels: ChannelDefinition[] }>("/v1/meta/channels", { method: "GET" });
    },
    staleTime: 5 * 60_000,
  });
}

export function useChannelAccounts(orgId: string | null, channelId?: string | null) {
  return useQuery({
    queryKey: ["channelAccounts", orgId, channelId ?? null],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
      return apiFetchJson<{ accounts: ChannelAccount[] }>(
        `/v1/orgs/${orgId}/channels/accounts${query}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useChannelAccount(orgId: string | null, accountId: string | null) {
  return useQuery({
    queryKey: ["channelAccount", orgId, accountId],
    enabled: Boolean(orgId && accountId),
    queryFn: async () => {
      return apiFetchJson<{ account: ChannelAccount }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useChannelAccountStatus(orgId: string | null, accountId: string | null) {
  return useQuery({
    queryKey: ["channelAccountStatus", orgId, accountId],
    enabled: Boolean(orgId && accountId),
    queryFn: async () => {
      return apiFetchJson<{ status: ChannelAccountStatusPayload }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/status`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useChannelPairingRequests(
  orgId: string | null,
  input?: { accountId?: string | null; status?: "pending" | "approved" | "rejected" | null }
) {
  return useQuery({
    queryKey: ["channelPairingRequests", orgId, input?.accountId ?? null, input?.status ?? null],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (input?.accountId) params.set("accountId", input.accountId);
      if (input?.status) params.set("status", input.status);
      const suffix = params.toString().length > 0 ? `?${params.toString()}` : "";
      return apiFetchJson<{ requests: ChannelPairingRequest[] }>(
        `/v1/orgs/${orgId}/channels/pairing/requests${suffix}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useChannelAllowlistEntries(
  orgId: string | null,
  accountId: string | null,
  scope?: string | null
) {
  return useQuery({
    queryKey: ["channelAllowlistEntries", orgId, accountId, scope ?? null],
    enabled: Boolean(orgId && accountId),
    queryFn: async () => {
      const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
      return apiFetchJson<{ entries: ChannelAllowlistEntry[] }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist${query}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useCreateChannelAccount(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      channelId: string;
      accountKey: string;
      displayName?: string;
      enabled?: boolean;
      dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
      groupPolicy?: "allowlist" | "open" | "disabled";
      requireMentionInGroup?: boolean;
      webhookUrl?: string;
      metadata?: Record<string, unknown>;
    }) => {
      return apiFetchJson<{ account: ChannelAccount }>(
        `/v1/orgs/${orgId}/channels/accounts`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channelPairingRequests", orgId] });
    },
  });
}

export function useUpdateChannelAccount(orgId: string | null, accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      displayName?: string | null;
      enabled?: boolean;
      dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
      groupPolicy?: "allowlist" | "open" | "disabled";
      requireMentionInGroup?: boolean;
      webhookUrl?: string | null;
      metadata?: Record<string, unknown>;
      status?: string;
      lastError?: string | null;
    }) => {
      return apiFetchJson<{ account: ChannelAccount }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccount", orgId, accountId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccountStatus", orgId, accountId] });
    },
  });
}

export function useDeleteChannelAccount(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      return apiFetchJson<{ ok: boolean }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}`,
        { method: "DELETE" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
    },
  });
}

export function useCreateChannelSecret(orgId: string | null, accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; value: string }) => {
      return apiFetchJson<{ secret: { id: string; name: string; createdAt: string; updatedAt: string } }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/secrets`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAccountStatus", orgId, accountId] });
    },
  });
}

export function useRunChannelAccountAction(orgId: string | null, accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: "start" | "stop" | "reconnect" | "login" | "logout") => {
      return apiFetchJson<{ ok: boolean; action: string; account: ChannelAccount }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/actions/${action}`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccount", orgId, accountId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccountStatus", orgId, accountId] });
    },
  });
}

export function useApprovePairingRequest(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      return apiFetchJson<{ request: ChannelPairingRequest }>(
        `/v1/orgs/${orgId}/channels/pairing/requests/${requestId}/approve`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelPairingRequests", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
    },
  });
}

export function useRejectPairingRequest(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      return apiFetchJson<{ request: ChannelPairingRequest }>(
        `/v1/orgs/${orgId}/channels/pairing/requests/${requestId}/reject`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelPairingRequests", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccounts", orgId] });
    },
  });
}

export function usePutChannelAllowlistEntry(orgId: string | null, accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: string; subject: string }) => {
      return apiFetchJson<{ entry: ChannelAllowlistEntry }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
        { method: "PUT", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAllowlistEntries", orgId, accountId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccountStatus", orgId, accountId] });
    },
  });
}

export function useDeleteChannelAllowlistEntry(orgId: string | null, accountId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scope: string; subject: string }) => {
      return apiFetchJson<{ ok: boolean }>(
        `/v1/orgs/${orgId}/channels/accounts/${accountId}/allowlist`,
        { method: "DELETE", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["channelAllowlistEntries", orgId, accountId] });
      await queryClient.invalidateQueries({ queryKey: ["channelAccountStatus", orgId, accountId] });
    },
  });
}
