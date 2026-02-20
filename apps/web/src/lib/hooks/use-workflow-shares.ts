import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";
import type { Workflow, WorkflowRun, WorkflowRunEvent } from "./use-workflows";

export type WorkflowShareInvitation = {
  id: string;
  organizationId: string;
  workflowId: string;
  email: string;
  accessRole: "runner";
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type WorkflowShare = {
  id: string;
  organizationId: string;
  workflowId: string;
  userId: string;
  accessRole: "runner";
  sourceInvitationId: string | null;
  createdByUserId: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function useWorkflowShares(
  orgId: string | null,
  workflowId: string | null,
  options?: { includeRevoked?: boolean; enabled?: boolean }
) {
  const includeRevoked = options?.includeRevoked ?? false;
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: ["workflowShares", orgId, workflowId, includeRevoked],
    enabled: Boolean(enabled && orgId && workflowId),
    queryFn: async () => {
      const query = new URLSearchParams();
      query.set("includeRevoked", includeRevoked ? "1" : "0");
      return apiFetchJson<{ shares: WorkflowShare[]; invitations: WorkflowShareInvitation[] }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/shares?${query.toString()}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
  });
}

export function useCreateWorkflowShareInvitation(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; ttlHours?: number }) => {
      return apiFetchJson<{ invitation: WorkflowShareInvitation; inviteUrl: string }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/shares/invitations`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflowShares", orgId, workflowId] });
    },
  });
}

export function useRevokeWorkflowShare(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shareId: string }) => {
      return apiFetchJson<{ share: WorkflowShare }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/shares/${input.shareId}`,
        { method: "DELETE" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflowShares", orgId, workflowId] });
    },
  });
}

export function useAcceptWorkflowShareInvitation() {
  return useMutation({
    mutationFn: async (input: { token: string }) => {
      return apiFetchJson<{ invitation: WorkflowShareInvitation; share: WorkflowShare; workflow: Pick<Workflow, "id" | "name" | "status"> }>(
        `/v1/workflow-shares/invitations/${encodeURIComponent(input.token)}/accept`,
        { method: "POST" }
      );
    },
  });
}

export function useSharedWorkflow(shareId: string | null) {
  return useQuery({
    queryKey: ["sharedWorkflow", shareId],
    enabled: Boolean(shareId),
    queryFn: async () => {
      return apiFetchJson<{ share: WorkflowShare; workflow: Workflow }>(`/v1/workflow-shares/${shareId}`, { method: "GET" });
    },
  });
}

export function useSharedWorkflowRuns(shareId: string | null) {
  return useQuery({
    queryKey: ["sharedWorkflowRuns", shareId],
    enabled: Boolean(shareId),
    queryFn: async () => {
      return apiFetchJson<{ runs: WorkflowRun[] }>(`/v1/workflow-shares/${shareId}/runs`, { method: "GET" });
    },
    refetchInterval: 4_000,
  });
}

export function useCreateSharedWorkflowRun(shareId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { input: unknown }) => {
      return apiFetchJson<{ run: WorkflowRun }>(
        `/v1/workflow-shares/${shareId}/runs`,
        { method: "POST", body: JSON.stringify(input) }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sharedWorkflowRuns", shareId] });
    },
  });
}

export function useSharedWorkflowRunEvents(shareId: string | null, runId: string | null) {
  return useQuery({
    queryKey: ["sharedWorkflowRunEvents", shareId, runId],
    enabled: Boolean(shareId && runId),
    queryFn: async () => {
      return apiFetchJson<{ events: WorkflowRunEvent[] }>(
        `/v1/workflow-shares/${shareId}/runs/${runId}/events?limit=200`,
        { method: "GET" }
      );
    },
    refetchInterval: 2_000,
  });
}
