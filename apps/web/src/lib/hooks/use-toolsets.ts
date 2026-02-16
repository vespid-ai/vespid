"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../api";

export type ToolsetVisibility = "private" | "org" | "public";

export type McpServerConfig = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  description?: string;
};

export type AgentSkillFile = { path: string; content: string; encoding?: "utf8" | "base64" };
export type AgentSkillBundle = {
  format: "agentskills-v1";
  id: string;
  name: string;
  description?: string;
  entry: "SKILL.md";
  files: AgentSkillFile[];
  enabled?: boolean;
  optionalDirs?: { scripts?: boolean; references?: boolean; assets?: boolean };
};

export type Toolset = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  visibility: ToolsetVisibility;
  publicSlug: string | null;
  publishedAt: string | null;
  mcpServers: McpServerConfig[];
  agentSkills: AgentSkillBundle[];
  adoptedFrom?: { toolsetId: string; publicSlug: string | null } | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicToolsetCard = {
  id: string;
  name: string;
  description: string | null;
  publicSlug: string;
  publishedAt: string;
  mcpServerCount: number;
  agentSkillCount: number;
};

export function useToolsets(orgId: string | null) {
  return useQuery({
    queryKey: ["toolsets", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      return apiFetchJson<{ toolsets: Toolset[] }>(`/v1/orgs/${orgId}/toolsets`, { method: "GET" }, { orgScoped: true });
    },
  });
}

export function useCreateToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string | null; visibility: "private" | "org"; mcpServers: McpServerConfig[]; agentSkills: AgentSkillBundle[] }) => {
      return apiFetchJson<{ toolset: Toolset }>(
        `/v1/orgs/${orgId}/toolsets`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
    },
  });
}

export function useUpdateToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { toolsetId: string; name: string; description?: string | null; visibility: "private" | "org"; mcpServers: McpServerConfig[]; agentSkills: AgentSkillBundle[] }) => {
      const { toolsetId, ...body } = input;
      return apiFetchJson<{ toolset: Toolset }>(
        `/v1/orgs/${orgId}/toolsets/${input.toolsetId}`,
        { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
    },
  });
}

export function useDeleteToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (toolsetId: string) => {
      return apiFetchJson<{ ok: true }>(`/v1/orgs/${orgId}/toolsets/${toolsetId}`, { method: "DELETE" }, { orgScoped: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
    },
  });
}

export function usePublishToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { toolsetId: string; publicSlug: string }) => {
      return apiFetchJson<{ toolset: Toolset }>(
        `/v1/orgs/${orgId}/toolsets/${input.toolsetId}/publish`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicSlug: input.publicSlug }) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["toolset-gallery"] });
    },
  });
}

export function useUnpublishToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { toolsetId: string; visibility?: "private" | "org" }) => {
      return apiFetchJson<{ toolset: Toolset }>(
        `/v1/orgs/${orgId}/toolsets/${input.toolsetId}/unpublish`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: input.visibility }) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
      await queryClient.invalidateQueries({ queryKey: ["toolset-gallery"] });
    },
  });
}

export function usePublicToolsetGallery(enabled = true) {
  return useQuery({
    queryKey: ["toolset-gallery"],
    enabled,
    queryFn: async () => {
      return apiFetchJson<{ items: PublicToolsetCard[] }>(`/v1/toolset-gallery`, { method: "GET" });
    },
  });
}

export function usePublicToolset(publicSlug: string | null) {
  return useQuery({
    queryKey: ["toolset-gallery", publicSlug],
    enabled: Boolean(publicSlug),
    queryFn: async () => {
      return apiFetchJson<{ toolset: Toolset }>(`/v1/toolset-gallery/${publicSlug}`, { method: "GET" });
    },
  });
}

export function useAdoptPublicToolset(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { publicSlug: string; name?: string; description?: string }) => {
      return apiFetchJson<{ toolset: Toolset }>(
        `/v1/orgs/${orgId}/toolset-gallery/${input.publicSlug}/adopt`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: input.name, description: input.description }) },
        { orgScoped: true }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["toolsets", orgId] });
    },
  });
}
