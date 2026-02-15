"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../../components/ui/dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Separator } from "../../../../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { Textarea } from "../../../../components/ui/textarea";
import { CodeBlock } from "../../../../components/ui/code-block";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";
import {
  type AgentSkillBundle,
  type AgentSkillFile,
  type McpServerConfig,
  type Toolset,
  useAdoptPublicToolset,
  useCreateToolset,
  useDeleteToolset,
  usePublicToolset,
  usePublicToolsetGallery,
  usePublishToolset,
  useToolsets,
  useUnpublishToolset,
  useUpdateToolset,
} from "../../../../lib/hooks/use-toolsets";

const ENV_PLACEHOLDER_RE = /^\$\{ENV:[A-Z0-9_]{1,128}\}$/;

function parseKvLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k || !v) continue;
    out[k] = v;
  }
  return out;
}

function kvToLines(value: Record<string, string> | undefined): string {
  const entries = Object.entries(value ?? {});
  return entries.map(([k, v]) => `${k}=${v}`).join("\n");
}

function validatePlaceholderRecord(record: Record<string, string>) {
  for (const [k, v] of Object.entries(record)) {
    if (!ENV_PLACEHOLDER_RE.test(v)) {
      return `Invalid placeholder for ${k}`;
    }
  }
  return null;
}

type ToolsetDraft = {
  name: string;
  description: string;
  visibility: "private" | "org";
  mcpServers: McpServerConfig[];
  agentSkills: AgentSkillBundle[];
};

function emptyDraft(): ToolsetDraft {
  return { name: "", description: "", visibility: "private", mcpServers: [], agentSkills: [] };
}

function toolsetToDraft(t: Toolset): ToolsetDraft {
  return {
    name: t.name ?? "",
    description: t.description ?? "",
    visibility: t.visibility === "org" ? "org" : "private",
    mcpServers: Array.isArray(t.mcpServers) ? t.mcpServers : [],
    agentSkills: Array.isArray(t.agentSkills) ? t.agentSkills : [],
  };
}

function isPublished(toolset: Toolset): boolean {
  return toolset.visibility === "public" && typeof toolset.publicSlug === "string" && toolset.publicSlug.length > 0;
}

function ToolsetEditorDialog(props: {
  title: string;
  initial: ToolsetDraft;
  trigger?: ReactNode;
  onSave: (draft: ToolsetDraft) => Promise<void>;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ToolsetDraft>(props.initial);

  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [mcpEditIndex, setMcpEditIndex] = useState<number | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpServerConfig>({
    name: "",
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
    enabled: true,
    description: "",
  });
  const [mcpEnvLines, setMcpEnvLines] = useState("");
  const [mcpHeaderLines, setMcpHeaderLines] = useState("");

  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [skillEditIndex, setSkillEditIndex] = useState<number | null>(null);
  const [skillDraft, setSkillDraft] = useState<AgentSkillBundle>({
    format: "agentskills-v1",
    id: "",
    name: "",
    entry: "SKILL.md",
    files: [{ path: "SKILL.md", content: "# Skill\n", encoding: "utf8" }],
    enabled: true,
  });

  function reset() {
    setDraft(props.initial);
  }

  async function save() {
    if (draft.name.trim().length === 0) {
      toast.error("Name is required.");
      return;
    }
    await props.onSave({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
    });
    setOpen(false);
  }

  function openMcpEditor(index: number | null) {
    setMcpEditIndex(index);
    const base =
      index === null
        ? ({
            name: "",
            transport: "stdio",
            command: "",
            args: [],
            env: {},
            url: "",
            headers: {},
            enabled: true,
            description: "",
          } satisfies McpServerConfig)
        : (draft.mcpServers[index] as McpServerConfig);
    setMcpDraft({
      name: base.name ?? "",
      transport: base.transport ?? "stdio",
      command: base.command ?? "",
      args: base.args ?? [],
      env: base.env ?? {},
      url: base.url ?? "",
      headers: base.headers ?? {},
      enabled: base.enabled ?? true,
      description: base.description ?? "",
    });
    setMcpEnvLines(kvToLines(base.env));
    setMcpHeaderLines(kvToLines(base.headers));
    setMcpEditorOpen(true);
  }

  function saveMcpEditor() {
    const env = parseKvLines(mcpEnvLines);
    const headers = parseKvLines(mcpHeaderLines);
    const envErr = validatePlaceholderRecord(env);
    if (envErr) {
      toast.error(`${envErr}. ${t("toolsets.placeholderEnv")}`);
      return;
    }
    const headerErr = validatePlaceholderRecord(headers);
    if (headerErr) {
      toast.error(`${headerErr}. ${t("toolsets.placeholderEnv")}`);
      return;
    }

    if (mcpDraft.name.trim().length === 0) {
      toast.error("MCP name is required.");
      return;
    }
    if (mcpDraft.transport === "stdio" && (!mcpDraft.command || mcpDraft.command.trim().length === 0)) {
      toast.error("command is required for stdio transport.");
      return;
    }
    if (mcpDraft.transport === "http" && (!mcpDraft.url || mcpDraft.url.trim().length === 0)) {
      toast.error("url is required for http transport.");
      return;
    }

    const next: McpServerConfig = {
      name: mcpDraft.name.trim(),
      transport: mcpDraft.transport,
      ...(mcpDraft.transport === "stdio" ? { command: (mcpDraft.command ?? "").trim(), args: mcpDraft.args ?? [] } : {}),
      ...(mcpDraft.transport === "http" ? { url: (mcpDraft.url ?? "").trim() } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(typeof mcpDraft.enabled === "boolean" ? { enabled: mcpDraft.enabled } : {}),
      ...(mcpDraft.description && mcpDraft.description.trim().length > 0 ? { description: mcpDraft.description.trim() } : {}),
    };

    setDraft((prev) => {
      const list = [...prev.mcpServers];
      if (mcpEditIndex === null) list.push(next);
      else list[mcpEditIndex] = next;
      return { ...prev, mcpServers: list };
    });
    setMcpEditorOpen(false);
  }

  function openSkillEditor(index: number | null) {
    setSkillEditIndex(index);
    const base =
      index === null
        ? ({
            format: "agentskills-v1",
            id: "",
            name: "",
            entry: "SKILL.md",
            files: [{ path: "SKILL.md", content: "# Skill\n", encoding: "utf8" }],
            enabled: true,
          } satisfies AgentSkillBundle)
        : (draft.agentSkills[index] as AgentSkillBundle);
    const files = Array.isArray(base.files) ? base.files : [];
    const hasSkillMd = files.some((f) => f.path === "SKILL.md");
    const normalizedFiles: AgentSkillFile[] = hasSkillMd ? files : [{ path: "SKILL.md", content: "# Skill\n", encoding: "utf8" }, ...files];
    setSkillDraft({
      format: "agentskills-v1",
      id: base.id ?? "",
      name: base.name ?? "",
      ...(typeof base.description === "string" ? { description: base.description } : {}),
      entry: "SKILL.md",
      files: normalizedFiles,
      enabled: base.enabled ?? true,
      ...(base.optionalDirs ? { optionalDirs: base.optionalDirs } : {}),
    });
    setSkillEditorOpen(true);
  }

  function saveSkillEditor() {
    if (skillDraft.id.trim().length === 0 || skillDraft.name.trim().length === 0) {
      toast.error("Skill id and name are required.");
      return;
    }
    const hasSkillMd = (skillDraft.files ?? []).some((f) => f.path === "SKILL.md");
    if (!hasSkillMd) {
      toast.error("SKILL.md is required.");
      return;
    }
    const next: AgentSkillBundle = {
      ...skillDraft,
      id: skillDraft.id.trim(),
      name: skillDraft.name.trim(),
      ...(skillDraft.description && skillDraft.description.trim().length > 0 ? { description: skillDraft.description.trim() } : {}),
    };

    setDraft((prev) => {
      const list = [...prev.agentSkills];
      if (skillEditIndex === null) list.push(next);
      else list[skillEditIndex] = next;
      return { ...prev, agentSkills: list };
    });
    setSkillEditorOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{t("toolsets.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="mt-3 grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("toolsets.name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("toolsets.visibility")}</Label>
              <select
                className="h-10 w-full rounded-md border border-border bg-panel/60 px-3 text-sm text-text shadow-sm outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
                value={draft.visibility}
                onChange={(e) => setDraft((p) => ({ ...p, visibility: e.target.value as any }))}
              >
                <option value="private">private</option>
                <option value="org">org</option>
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("toolsets.description")}</Label>
            <Textarea value={draft.description} onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} />
          </div>

          <Separator />

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-text">{t("toolsets.mcpServers")}</div>
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={() => openMcpEditor(null)}>
                  {t("common.add")}
                </Button>
              </div>
            </div>
            {draft.mcpServers.length === 0 ? (
              <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">No MCP servers.</div>
            ) : (
              <div className="grid gap-2">
                {draft.mcpServers.map((s, idx) => (
                  <div key={`${s.name}-${idx}`} className="flex items-center gap-2 rounded-md border border-borderSubtle bg-panel/40 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text">
                        {s.name} <span className="text-xs text-muted">({s.transport})</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {s.transport === "stdio" ? s.command : s.url}
                      </div>
                    </div>
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openMcpEditor(idx)}>
                        {t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDraft((p) => ({ ...p, mcpServers: p.mcpServers.filter((_, i) => i !== idx) }))}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-text">{t("toolsets.agentSkills")}</div>
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={() => openSkillEditor(null)}>
                  {t("common.add")}
                </Button>
              </div>
            </div>
            {draft.agentSkills.length === 0 ? (
              <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">No skills.</div>
            ) : (
              <div className="grid gap-2">
                {draft.agentSkills.map((s, idx) => (
                  <div key={`${s.id}-${idx}`} className="flex items-center gap-2 rounded-md border border-borderSubtle bg-panel/40 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text">{s.name}</div>
                      <div className="truncate font-mono text-xs text-muted">{s.id}</div>
                    </div>
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openSkillEditor(idx)}>
                        {t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDraft((p) => ({ ...p, agentSkills: p.agentSkills.filter((_, i) => i !== idx) }))}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="accent" onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </div>

        <Dialog open={mcpEditorOpen} onOpenChange={setMcpEditorOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>MCP server</DialogTitle>
              <DialogDescription>{t("toolsets.placeholderEnv")}</DialogDescription>
            </DialogHeader>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={mcpDraft.name} onChange={(e) => setMcpDraft((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Transport</Label>
                <select
                  className="h-10 w-full rounded-md border border-border bg-panel/60 px-3 text-sm text-text shadow-sm outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
                  value={mcpDraft.transport}
                  onChange={(e) => setMcpDraft((p) => ({ ...p, transport: e.target.value as any }))}
                >
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
              </div>
              {mcpDraft.transport === "stdio" ? (
                <>
                  <div className="grid gap-1.5">
                    <Label>command</Label>
                    <Input value={mcpDraft.command ?? ""} onChange={(e) => setMcpDraft((p) => ({ ...p, command: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>args (comma-separated)</Label>
                    <Input
                      value={(mcpDraft.args ?? []).join(",")}
                      onChange={(e) => setMcpDraft((p) => ({ ...p, args: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
                    />
                  </div>
                </>
              ) : (
                <div className="grid gap-1.5">
                  <Label>url</Label>
                  <Input value={mcpDraft.url ?? ""} onChange={(e) => setMcpDraft((p) => ({ ...p, url: e.target.value }))} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>env (one per line: KEY=${"{ENV:VAR}"})</Label>
                <Textarea value={mcpEnvLines} onChange={(e) => setMcpEnvLines(e.target.value)} className="min-h-[110px]" />
              </div>
              <div className="grid gap-1.5">
                <Label>headers (one per line: KEY=${"{ENV:VAR}"})</Label>
                <Textarea value={mcpHeaderLines} onChange={(e) => setMcpHeaderLines(e.target.value)} className="min-h-[110px]" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setMcpEditorOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="accent" onClick={saveMcpEditor}>
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={skillEditorOpen} onOpenChange={setSkillEditorOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Agent Skill bundle</DialogTitle>
              <DialogDescription>Bundle format: agentskills-v1</DialogDescription>
            </DialogHeader>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>id</Label>
                  <Input value={skillDraft.id} onChange={(e) => setSkillDraft((p) => ({ ...p, id: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>name</Label>
                  <Input value={skillDraft.name} onChange={(e) => setSkillDraft((p) => ({ ...p, name: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>SKILL.md</Label>
                <Textarea
                  value={(skillDraft.files.find((f) => f.path === "SKILL.md")?.content ?? "") as string}
                  onChange={(e) =>
                    setSkillDraft((p) => ({
                      ...p,
                      files: p.files.map((f) => (f.path === "SKILL.md" ? { ...f, content: e.target.value } : f)),
                    }))
                  }
                  className="min-h-[220px] font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSkillEditorOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="accent" onClick={saveSkillEditor}>
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

export default function ToolsetsPage() {
  const t = useTranslations();
  const orgId = useActiveOrgId();

  const toolsetsQuery = useToolsets(orgId);
  const createToolset = useCreateToolset(orgId);
  const updateToolset = useUpdateToolset(orgId);
  const deleteToolset = useDeleteToolset(orgId);
  const publishToolset = usePublishToolset(orgId);
  const unpublishToolset = useUnpublishToolset(orgId);
  const settingsQuery = useOrgSettings(orgId);
  const updateSettings = useUpdateOrgSettings(orgId);

  const galleryQuery = usePublicToolsetGallery();
  const adoptToolset = useAdoptPublicToolset(orgId);

  const toolsets = toolsetsQuery.data?.toolsets ?? [];
  const defaultToolsetId = settingsQuery.data?.settings?.toolsets?.defaultToolsetId ?? null;

  const [publishSlug, setPublishSlug] = useState("");
  const [publishId, setPublishId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const [gallerySelectedSlug, setGallerySelectedSlug] = useState<string | null>(null);
  const selectedPublicQuery = usePublicToolset(gallerySelectedSlug);
  const [galleryDetailOpen, setGalleryDetailOpen] = useState(false);

  const [adoptSlug, setAdoptSlug] = useState<string | null>(null);
  const [adoptName, setAdoptName] = useState("");
  const [adoptOpen, setAdoptOpen] = useState(false);

  const columns = useMemo(() => {
    return [
      {
        header: t("toolsets.name"),
        accessorKey: "name",
        cell: ({ row }: any) => {
          const toolset = row.original as Toolset;
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-text">
                {toolset.name}{" "}
                {toolset.id === defaultToolsetId ? (
                  <span className="ml-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    {t("toolsets.default")}
                  </span>
                ) : null}
              </div>
              <div className="truncate font-mono text-xs text-muted">{toolset.id}</div>
              {toolset.description ? <div className="mt-1 truncate text-xs text-muted">{toolset.description}</div> : null}
            </div>
          );
        },
      },
      {
        header: t("toolsets.visibility"),
        accessorKey: "visibility",
        cell: ({ row }: any) => <span className="text-muted">{row.original.visibility}</span>,
      },
      {
        header: t("toolsets.publicSlug"),
        accessorKey: "publicSlug",
        cell: ({ row }: any) => <span className="font-mono text-xs text-muted">{row.original.publicSlug ?? "-"}</span>,
      },
      {
        header: t("common.actions"),
        id: "actions",
        cell: ({ row }: any) => {
          const toolset = row.original as Toolset;
          return (
            <div className="flex flex-wrap gap-2">
              <ToolsetEditorDialog
                title={t("toolsets.edit")}
                initial={toolsetToDraft(toolset)}
                trigger={
                  <Button size="sm" variant="outline">
                    {t("common.edit")}
                  </Button>
                }
                onSave={async (draft) => {
                  await updateToolset.mutateAsync({
                    toolsetId: toolset.id,
                    name: draft.name,
                    description: draft.description,
                    visibility: draft.visibility,
                    mcpServers: draft.mcpServers,
                    agentSkills: draft.agentSkills,
                  });
                  toast.success(t("common.saved"));
                }}
              />

              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!orgId) return;
                  await updateSettings.mutateAsync({ toolsets: { defaultToolsetId: toolset.id } });
                  toast.success(t("common.saved"));
                }}
                disabled={!orgId || updateSettings.isPending}
              >
                {t("toolsets.setDefault")}
              </Button>

              {isPublished(toolset) ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await unpublishToolset.mutateAsync({ toolsetId: toolset.id, visibility: "org" });
                    toast.success(t("common.saved"));
                  }}
                  disabled={unpublishToolset.isPending}
                >
                  {t("toolsets.unpublish")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPublishId(toolset.id);
                    setPublishSlug("");
                    setPublishOpen(true);
                  }}
                >
                  {t("toolsets.publish")}
                </Button>
              )}

              <ConfirmButton
                title={t("toolsets.delete")}
                description="This cannot be undone."
                confirmText={t("common.delete")}
                onConfirm={async () => {
                  await deleteToolset.mutateAsync(toolset.id);
                  toast.success(t("common.deleted"));
                }}
              >
                {t("common.delete")}
              </ConfirmButton>
            </div>
          );
        },
      },
    ] as const;
  }, [defaultToolsetId, deleteToolset, orgId, t, unpublishToolset, updateSettings, updateToolset]);

  const galleryItems = galleryQuery.data?.items ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("toolsets.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("toolsets.subtitle")}</div>
      </div>

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">{t("toolsets.tabs.library")}</TabsTrigger>
          <TabsTrigger value="gallery">{t("toolsets.tabs.gallery")}</TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <Card>
            <CardHeader>
              <CardTitle>{t("toolsets.tabs.library")}</CardTitle>
              <CardDescription>{orgId ? `Org: ${orgId}` : t("org.requireActive")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => toolsetsQuery.refetch()} disabled={!orgId}>
                  {t("common.refresh")}
                </Button>

                <ToolsetEditorDialog
                  title={t("toolsets.create")}
                  initial={emptyDraft()}
                  trigger={
                    <Button variant="accent" disabled={!orgId}>
                      {t("common.create")}
                    </Button>
                  }
                  onSave={async (draft) => {
                    if (!orgId) {
                      toast.error(t("org.requireActive"));
                      return;
                    }
                    await createToolset.mutateAsync({
                      name: draft.name,
                      description: draft.description,
                      visibility: draft.visibility,
                      mcpServers: draft.mcpServers,
                      agentSkills: draft.agentSkills,
                    });
                    toast.success(t("common.created"));
                  }}
                />

                {defaultToolsetId ? (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!orgId) return;
                      await updateSettings.mutateAsync({ toolsets: { defaultToolsetId: null } });
                      toast.success(t("common.saved"));
                    }}
                    disabled={!orgId || updateSettings.isPending}
                  >
                    Clear default
                  </Button>
                ) : null}

                <div className="ml-auto text-xs text-muted">
                  {toolsetsQuery.isFetching ? t("common.loading") : `${toolsets.length} toolset(s)`}
                </div>
              </div>

              <div className="mt-4">
                {toolsetsQuery.isLoading ? (
                  <EmptyState title={t("common.loading")} />
                ) : toolsets.length === 0 ? (
                  <EmptyState title={t("toolsets.emptyLibraryTitle")} description={t("toolsets.emptyLibraryDescription")} />
                ) : (
                  <DataTable data={toolsets} columns={columns as any} />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gallery">
          <Card>
            <CardHeader>
              <CardTitle>{t("toolsets.tabs.gallery")}</CardTitle>
              <CardDescription>Public toolsets</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => galleryQuery.refetch()}>{t("common.refresh")}</Button>
                <div className="ml-auto text-xs text-muted">
                  {galleryQuery.isFetching ? t("common.loading") : `${galleryItems.length} item(s)`}
                </div>
              </div>

              <div className="mt-4">
                {galleryQuery.isLoading ? (
                  <EmptyState title={t("common.loading")} />
                ) : galleryItems.length === 0 ? (
                  <EmptyState title={t("toolsets.emptyGalleryTitle")} description={t("toolsets.emptyGalleryDescription")} />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {galleryItems.map((it) => (
                      <div key={it.publicSlug} className="rounded-lg border border-borderSubtle bg-panel/40 p-4 shadow-elev1">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-text">{it.name}</div>
                            <div className="mt-1 truncate font-mono text-xs text-muted">{it.publicSlug}</div>
                            {it.description ? <div className="mt-2 text-sm text-muted">{it.description}</div> : null}
                            <div className="mt-2 text-xs text-muted">
                              {it.mcpServerCount} MCP, {it.agentSkillCount} skills
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setGallerySelectedSlug(it.publicSlug);
                                setGalleryDetailOpen(true);
                              }}
                            >
                              {t("common.view")}
                            </Button>
                            <Button
                              size="sm"
                              variant="accent"
                              disabled={!orgId}
                              onClick={() => {
                                setAdoptSlug(it.publicSlug);
                                setAdoptName(`${it.name} (Adopted)`);
                                setAdoptOpen(true);
                              }}
                            >
                              {t("toolsets.adopt")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("toolsets.publish")}</DialogTitle>
            <DialogDescription>{t("toolsets.publicSlug")}</DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("toolsets.publicSlug")}</Label>
              <Input value={publishSlug} onChange={(e) => setPublishSlug(e.target.value)} placeholder="e.g. my-toolset" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPublishOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="accent"
                onClick={async () => {
                  if (!publishId) return;
                  await publishToolset.mutateAsync({ toolsetId: publishId, publicSlug: publishSlug.trim() });
                  toast.success(t("common.saved"));
                  setPublishOpen(false);
                }}
                disabled={publishToolset.isPending || publishSlug.trim().length === 0}
              >
                {t("toolsets.publish")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={galleryDetailOpen} onOpenChange={setGalleryDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("toolsets.tabs.gallery")}</DialogTitle>
            <DialogDescription>{gallerySelectedSlug ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            {selectedPublicQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : selectedPublicQuery.data?.toolset ? (
              <CodeBlock value={selectedPublicQuery.data.toolset} />
            ) : (
              <EmptyState title={t("common.notFound")} />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adoptOpen} onOpenChange={setAdoptOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("toolsets.adopt")}</DialogTitle>
            <DialogDescription>{adoptSlug ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("toolsets.name")}</Label>
              <Input value={adoptName} onChange={(e) => setAdoptName(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdoptOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="accent"
                onClick={async () => {
                  if (!orgId || !adoptSlug) return;
                  await adoptToolset.mutateAsync({ publicSlug: adoptSlug, name: adoptName.trim() });
                  toast.success(t("common.created"));
                  setAdoptOpen(false);
                }}
                disabled={!orgId || adoptToolset.isPending || !adoptSlug || adoptName.trim().length === 0}
              >
                {t("toolsets.adopt")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
