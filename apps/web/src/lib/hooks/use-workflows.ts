import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type Workflow = {
  id: string;
  name: string;
  status?: "draft" | "published" | string;
  familyId?: string;
  revision?: number;
  sourceWorkflowId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  dsl?: unknown;
  editorState?: unknown;
};

export type WorkflowRun = {
  id: string;
  status: string;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  input?: unknown;
};

export type WorkflowRunEvent = Record<string, unknown> & {
  id?: string;
  createdAt?: string;
  attemptCount?: number;
  type?: string;
  nodeId?: string;
};

export function useWorkflow(orgId: string | null, workflowId: string | null) {
  return useQuery({
    queryKey: ["workflow", orgId, workflowId],
    enabled: Boolean(orgId && workflowId),
    queryFn: async () => {
      return apiFetchJson<{ workflow: Workflow }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
  });
}

export function useWorkflowRevisions(orgId: string | null, workflowId: string | null) {
  return useQuery({
    queryKey: ["workflowRevisions", orgId, workflowId],
    enabled: Boolean(orgId && workflowId),
    queryFn: async () => {
      return apiFetchJson<{ workflows: Workflow[] }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/revisions?limit=200`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useWorkflows(orgId: string | null) {
  return useQuery({
    queryKey: ["workflows", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ workflows: Workflow[]; nextCursor: string | null }>(
        `/v1/orgs/${orgId}/workflows?limit=100`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 10_000,
  });
}

export function useRuns(orgId: string | null, workflowId: string | null) {
  return useQuery({
    queryKey: ["runs", orgId, workflowId],
    enabled: Boolean(orgId && workflowId),
    queryFn: async () => {
      return apiFetchJson<{ runs: WorkflowRun[] }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 4000,
  });
}

export function useRun(orgId: string | null, workflowId: string | null, runId: string | null) {
  return useQuery({
    queryKey: ["run", orgId, workflowId, runId],
    enabled: Boolean(orgId && workflowId && runId),
    queryFn: async () => {
      return apiFetchJson<{ run: WorkflowRun }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 2000,
  });
}

export function useRunEvents(orgId: string | null, workflowId: string | null, runId: string | null) {
  return useQuery({
    queryKey: ["runEvents", orgId, workflowId, runId],
    enabled: Boolean(orgId && workflowId && runId),
    queryFn: async () => {
      return apiFetchJson<{ events: WorkflowRunEvent[] }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs/${runId}/events?limit=200`,
        { method: "GET" },
        { orgScoped: true }
      );
    },
    refetchInterval: 2000,
  });
}

export function useCreateWorkflow(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; dsl: unknown }) => {
      return apiFetchJson<{ workflow: Workflow }>(
        `/v1/orgs/${orgId}/workflows`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", orgId] });
    },
  });
}

export function useUpdateWorkflowDraft(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name?: string; dsl?: unknown; editorState?: unknown }) => {
      return apiFetchJson<{ workflow: Workflow }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}`,
        { method: "PUT", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflow", orgId, workflowId] });
      await queryClient.invalidateQueries({ queryKey: ["workflows", orgId] });
    },
  });
}

export function useCreateWorkflowDraftFromWorkflow(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiFetchJson<{ workflow: Workflow }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/drafts`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async (data) => {
      const newId = data.workflow?.id ?? null;
      await queryClient.invalidateQueries({ queryKey: ["workflows", orgId] });
      if (newId) {
        await queryClient.invalidateQueries({ queryKey: ["workflow", orgId, newId] });
      }
    },
  });
}

export function useClonePublishedWorkflowToDraft(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { workflowId: string }) => {
      return apiFetchJson<{ workflow: Workflow }>(
        `/v1/orgs/${orgId}/workflows/${input.workflowId}/drafts`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async (data) => {
      const newId = data.workflow?.id ?? null;
      await queryClient.invalidateQueries({ queryKey: ["workflows", orgId] });
      if (newId) {
        await queryClient.invalidateQueries({ queryKey: ["workflow", orgId, newId] });
      }
    },
  });
}

export function usePublishWorkflow(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiFetchJson<unknown>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/publish`,
        { method: "POST" },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflow", orgId, workflowId] });
    },
  });
}

export function useRunWorkflow(orgId: string | null, workflowId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { input: unknown }) => {
      return apiFetchJson<{ run: WorkflowRun }>(
        `/v1/orgs/${orgId}/workflows/${workflowId}/runs`,
        { method: "POST", body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", orgId, workflowId] });
    },
  });
}
