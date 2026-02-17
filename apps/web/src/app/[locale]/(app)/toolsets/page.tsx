"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { getDefaultModelForProvider, type LlmProviderId } from "@vespid/shared/llm/provider-registry";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { DataTable } from "../../../../components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../../components/ui/dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Separator } from "../../../../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/tabs";
import { Textarea } from "../../../../components/ui/textarea";
import { CodeBlock } from "../../../../components/ui/code-block";
import { ConfirmButton } from "../../../../components/app/confirm-button";
import { AdvancedSection } from "../../../../components/app/advanced-section";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { LlmConfigField } from "../../../../components/app/llm/llm-config-field";
import { useActiveOrgName } from "../../../../lib/hooks/use-active-org-name";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useOrgSettings, useUpdateOrgSettings } from "../../../../lib/hooks/use-org-settings";
import { useChatToolsetBuilderSession, useCreateToolsetBuilderSession, useFinalizeToolsetBuilderSession } from "../../../../lib/hooks/use-toolset-builder";
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
import type { ToolsetCatalogItem } from "@vespid/shared/toolset-builder";
import { isUnauthorizedError } from "../../../../lib/api";

const ENV_PLACEHOLDER_RE = /^\$\{ENV:[A-Z0-9_]{1,128}\}$/;
const MCP_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  try {
    // Use runtime locale (browser) for display.
    const fmt = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return fmt.format(d);
  } catch {
    return d.toISOString();
  }
}

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
      return k;
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
  const [skillActivePath, setSkillActivePath] = useState("SKILL.md");
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
      toast.error(t("toolsets.validation.nameRequired"));
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
    const envErrKey = validatePlaceholderRecord(env);
    if (envErrKey) {
      toast.error(`${t("toolsets.validation.invalidPlaceholderFor", { key: envErrKey })} ${t("toolsets.placeholderEnv")}`);
      return;
    }
    const headerErrKey = validatePlaceholderRecord(headers);
    if (headerErrKey) {
      toast.error(`${t("toolsets.validation.invalidPlaceholderFor", { key: headerErrKey })} ${t("toolsets.placeholderEnv")}`);
      return;
    }

    if (mcpDraft.name.trim().length === 0) {
      toast.error(t("toolsets.validation.mcpNameRequired"));
      return;
    }
    if (!MCP_NAME_RE.test(mcpDraft.name.trim())) {
      toast.error(t("toolsets.validation.invalidMcpServerName"));
      return;
    }
    if (mcpDraft.transport === "stdio" && (!mcpDraft.command || mcpDraft.command.trim().length === 0)) {
      toast.error(t("toolsets.validation.mcpCommandRequired"));
      return;
    }
    if (mcpDraft.transport === "http" && (!mcpDraft.url || mcpDraft.url.trim().length === 0)) {
      toast.error(t("toolsets.validation.mcpUrlRequired"));
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
    setSkillActivePath("SKILL.md");
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
      toast.error(t("toolsets.validation.skillIdNameRequired"));
      return;
    }
    if (!SKILL_ID_RE.test(skillDraft.id.trim())) {
      toast.error(t("toolsets.validation.invalidSkillId"));
      return;
    }
    const hasSkillMd = (skillDraft.files ?? []).some((f) => f.path === "SKILL.md");
    if (!hasSkillMd) {
      toast.error(t("toolsets.validation.skillMdRequired"));
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
              <Select value={draft.visibility} onValueChange={(value) => setDraft((p) => ({ ...p, visibility: value as any }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t("toolsets.visibilityOptions.private")}</SelectItem>
                  <SelectItem value="org">{t("toolsets.visibilityOptions.org")}</SelectItem>
                </SelectContent>
              </Select>
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
              <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("toolsets.noMcpServers")}</div>
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
              <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("toolsets.noSkills")}</div>
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
              <DialogTitle>{t("toolsets.mcpDialog.title")}</DialogTitle>
              <DialogDescription>{t("toolsets.placeholderEnv")}</DialogDescription>
            </DialogHeader>
            <div className="mt-3 grid gap-3">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={(mcpDraft.enabled ?? true) !== false}
                  onChange={(e) => setMcpDraft((p) => ({ ...p, enabled: e.target.checked }))}
                  className="h-4 w-4 accent-[color:var(--color-accent)]"
                />
                <span>{t("toolsets.mcpDialog.enabledLabel")}</span>
              </label>
              <div className="grid gap-1.5">
                <Label>{t("toolsets.mcpDialog.nameLabel")}</Label>
                <Input value={mcpDraft.name} onChange={(e) => setMcpDraft((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("toolsets.mcpDialog.transportLabel")}</Label>
                <Select value={mcpDraft.transport} onValueChange={(value) => setMcpDraft((p) => ({ ...p, transport: value as any }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="http">http</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mcpDraft.transport === "stdio" ? (
                <>
                  <div className="grid gap-1.5">
                    <Label>{t("toolsets.mcpDialog.commandLabel")}</Label>
                    <Input value={mcpDraft.command ?? ""} onChange={(e) => setMcpDraft((p) => ({ ...p, command: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("toolsets.mcpDialog.argsLabel")}</Label>
                    <Input
                      value={(mcpDraft.args ?? []).join(",")}
                      onChange={(e) => setMcpDraft((p) => ({ ...p, args: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
                    />
                  </div>
                </>
              ) : (
                <div className="grid gap-1.5">
                  <Label>{t("toolsets.mcpDialog.urlLabel")}</Label>
                  <Input value={mcpDraft.url ?? ""} onChange={(e) => setMcpDraft((p) => ({ ...p, url: e.target.value }))} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>{t("toolsets.mcpDialog.envLabel")}</Label>
                <Textarea value={mcpEnvLines} onChange={(e) => setMcpEnvLines(e.target.value)} className="min-h-[110px]" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("toolsets.mcpDialog.headersLabel")}</Label>
                <Textarea value={mcpHeaderLines} onChange={(e) => setMcpHeaderLines(e.target.value)} className="min-h-[110px]" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("toolsets.mcpDialog.descriptionLabel")}</Label>
                <Textarea
                  value={mcpDraft.description ?? ""}
                  onChange={(e) => setMcpDraft((p) => ({ ...p, description: e.target.value }))}
                  className="min-h-[90px]"
                />
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
              <DialogTitle>{t("toolsets.skillDialog.title")}</DialogTitle>
              <DialogDescription>{t("toolsets.skillDialog.subtitle")}</DialogDescription>
            </DialogHeader>
            <div className="mt-3 grid gap-3">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={(skillDraft.enabled ?? true) !== false}
                  onChange={(e) => setSkillDraft((p) => ({ ...p, enabled: e.target.checked }))}
                  className="h-4 w-4 accent-[color:var(--color-accent)]"
                />
                <span>{t("toolsets.skillDialog.enabledLabel")}</span>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>{t("toolsets.skillDialog.idLabel")}</Label>
                  <Input value={skillDraft.id} onChange={(e) => setSkillDraft((p) => ({ ...p, id: e.target.value }))} />
                </div>
	                <div className="grid gap-1.5">
	                  <Label>{t("toolsets.skillDialog.nameLabel")}</Label>
	                  <Input value={skillDraft.name} onChange={(e) => setSkillDraft((p) => ({ ...p, name: e.target.value }))} />
	                </div>
	              </div>
	              <div className="grid gap-1.5">
	                <Label>{t("toolsets.skillDialog.descriptionLabel")}</Label>
	                <Textarea
	                  value={skillDraft.description ?? ""}
	                  onChange={(e) => setSkillDraft((p) => ({ ...p, description: e.target.value }))}
	                  className="min-h-[90px]"
	                />
	              </div>
              <div className="grid gap-2 rounded-md border border-borderSubtle bg-panel/40 p-3">
                <div className="text-sm font-medium text-text">{t("toolsets.skillDialog.optionalDirs.title")}</div>
                <div className="grid gap-2 md:grid-cols-3">
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={Boolean(skillDraft.optionalDirs?.scripts)}
                      onChange={(e) =>
                        setSkillDraft((p) => ({ ...p, optionalDirs: { ...(p.optionalDirs ?? {}), scripts: e.target.checked } }))
                      }
                      className="h-4 w-4 accent-[color:var(--color-accent)]"
                    />
                    <span>{t("toolsets.skillDialog.optionalDirs.scripts")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={Boolean(skillDraft.optionalDirs?.references)}
                      onChange={(e) =>
                        setSkillDraft((p) => ({ ...p, optionalDirs: { ...(p.optionalDirs ?? {}), references: e.target.checked } }))
                      }
                      className="h-4 w-4 accent-[color:var(--color-accent)]"
                    />
                    <span>{t("toolsets.skillDialog.optionalDirs.references")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={Boolean(skillDraft.optionalDirs?.assets)}
                      onChange={(e) =>
                        setSkillDraft((p) => ({ ...p, optionalDirs: { ...(p.optionalDirs ?? {}), assets: e.target.checked } }))
                      }
                      className="h-4 w-4 accent-[color:var(--color-accent)]"
                    />
                    <span>{t("toolsets.skillDialog.optionalDirs.assets")}</span>
                  </label>
                </div>
              </div>
	              <div className="grid gap-1.5">
	                <Label>{t("toolsets.skillDialog.filesLabel")}</Label>
	                <div className="flex flex-wrap items-center gap-2">
                    <Select value={skillActivePath} onValueChange={setSkillActivePath}>
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(skillDraft.files ?? [])
                          .map((f) => f.path)
                          .filter(Boolean)
                          .map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
	                  <Button
	                    size="sm"
	                    variant="outline"
	                    onClick={() => {
	                      const existing = new Set((skillDraft.files ?? []).map((f) => f.path));
	                      let i = 1;
	                      let nextPath = "file.txt";
	                      while (existing.has(nextPath)) {
	                        i += 1;
	                        nextPath = `file-${i}.txt`;
	                      }
	                      setSkillDraft((p) => ({ ...p, files: [...(p.files ?? []), { path: nextPath, content: "", encoding: "utf8" }] }));
	                      setSkillActivePath(nextPath);
	                    }}
	                  >
	                    {t("toolsets.skillDialog.addFile")}
	                  </Button>
	                  <Button
	                    size="sm"
	                    variant="danger"
	                    disabled={skillActivePath === "SKILL.md"}
	                    onClick={() => {
	                      if (skillActivePath === "SKILL.md") return;
	                      setSkillDraft((p) => ({ ...p, files: (p.files ?? []).filter((f) => f.path !== skillActivePath) }));
	                      setSkillActivePath("SKILL.md");
	                    }}
	                  >
	                    {t("toolsets.skillDialog.removeFile")}
	                  </Button>
	                </div>
	              </div>
	              {(() => {
	                const files = skillDraft.files ?? [];
	                const active =
	                  files.find((f) => f.path === skillActivePath) ?? files.find((f) => f.path === "SKILL.md") ?? files[0];
	                if (!active) {
	                  return null;
	                }
	                const activeEncoding = active.encoding ?? "utf8";
	                const isSkillMd = active.path === "SKILL.md";
	                return (
	                  <div className="grid gap-3 rounded-md border border-borderSubtle bg-panel/40 p-3">
	                    <div className="grid gap-3 md:grid-cols-2">
	                      <div className="grid gap-1.5">
	                        <Label>{t("toolsets.skillDialog.filePathLabel")}</Label>
	                        <Input
	                          value={active.path}
	                          disabled={isSkillMd}
	                          onChange={(e) => {
	                            const nextPath = e.target.value;
	                            if (!nextPath) return;
	                            const exists = files.some((f) => f.path === nextPath && f !== active);
	                            if (exists) {
	                              toast.error(t("toolsets.validation.duplicateFilePath", { path: nextPath }));
	                              return;
	                            }
	                            setSkillDraft((p) => ({
	                              ...p,
	                              files: (p.files ?? []).map((f) => (f.path === active.path ? { ...f, path: nextPath } : f)),
	                            }));
	                            setSkillActivePath(nextPath);
	                          }}
	                        />
	                      </div>
	                      <div className="grid gap-1.5">
	                        <Label>{t("toolsets.skillDialog.fileEncodingLabel")}</Label>
                          <Select
                            value={activeEncoding}
                            onValueChange={(value) =>
                              setSkillDraft((p) => ({
                                ...p,
                                files: (p.files ?? []).map((f) => (f.path === active.path ? { ...f, encoding: value as any } : f)),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="utf8">utf8</SelectItem>
                              <SelectItem value="base64">base64</SelectItem>
                            </SelectContent>
                          </Select>
	                      </div>
	                    </div>
	                    <div className="grid gap-1.5">
	                      <Label>{active.path === "SKILL.md" ? t("toolsets.skillDialog.skillMdLabel") : t("toolsets.skillDialog.fileContentLabel")}</Label>
	                      <Textarea
	                        value={active.content ?? ""}
	                        onChange={(e) =>
	                          setSkillDraft((p) => ({
	                            ...p,
	                            files: (p.files ?? []).map((f) => (f.path === active.path ? { ...f, content: e.target.value } : f)),
	                          }))
	                        }
	                        className="min-h-[220px] font-mono text-xs"
	                      />
	                    </div>
	                  </div>
	                );
	              })()}
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
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const { orgId, orgName } = useActiveOrgName();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;

  const toolsetsQuery = useToolsets(scopedOrgId);
  const createToolset = useCreateToolset(scopedOrgId);
  const updateToolset = useUpdateToolset(scopedOrgId);
  const deleteToolset = useDeleteToolset(scopedOrgId);
  const publishToolset = usePublishToolset(scopedOrgId);
  const unpublishToolset = useUnpublishToolset(scopedOrgId);
  const settingsQuery = useOrgSettings(scopedOrgId);
  const updateSettings = useUpdateOrgSettings(scopedOrgId);

  const createBuilderSession = useCreateToolsetBuilderSession(scopedOrgId);
  const chatBuilderSession = useChatToolsetBuilderSession(scopedOrgId);
  const finalizeBuilderSession = useFinalizeToolsetBuilderSession(scopedOrgId);

  const galleryQuery = usePublicToolsetGallery(Boolean(scopedOrgId));
  const adoptToolset = useAdoptPublicToolset(scopedOrgId);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiStep, setAiStep] = useState<"start" | "chat" | "preview">("start");
  const [aiIntent, setAiIntent] = useState("");
  const [aiProvider, setAiProvider] = useState<LlmProviderId>("openai");
  const [aiModel, setAiModel] = useState("claude-3-5-sonnet-latest");
  const [aiSecretId, setAiSecretId] = useState("");
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);
  const [aiAssistant, setAiAssistant] = useState("");
  const [aiComponents, setAiComponents] = useState<ToolsetCatalogItem[]>([]);
  const [aiSelectedKeys, setAiSelectedKeys] = useState<string[]>([]);
  const [aiChatMessage, setAiChatMessage] = useState("");
  const [aiDraft, setAiDraft] = useState<any | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  function resetAiBuilder() {
    aiDefaultsInitRef.current = false;
    setAiStep("start");
    setAiIntent("");
    setAiProvider("openai");
    setAiModel("gpt-5.3-codex");
    setAiSecretId("");
    setAiSessionId(null);
    setAiAssistant("");
    setAiComponents([]);
    setAiSelectedKeys([]);
    setAiChatMessage("");
    setAiDraft(null);
    setAiWarnings([]);
  }

  const toolsets = toolsetsQuery.data?.toolsets ?? [];
  const defaultToolsetId = settingsQuery.data?.settings?.toolsets?.defaultToolsetId ?? null;

  const aiDefaultsInitRef = useRef(false);
  useEffect(() => {
    if (!aiOpen) {
      aiDefaultsInitRef.current = false;
      return;
    }
    if (aiStep !== "start") return;
    if (aiDefaultsInitRef.current) return;
    const d = (settingsQuery.data?.settings?.llm?.defaults?.primary as any) ?? null;
    if (d && typeof d === "object") {
      if (typeof d.provider === "string") {
        setAiProvider(d.provider);
      }
      if (typeof d.model === "string" && d.model.trim().length > 0) {
        setAiModel(d.model);
      } else if (typeof d.provider === "string") {
        setAiModel(getDefaultModelForProvider(d.provider) ?? "gpt-5.3-codex");
      }
      if (typeof d.secretId === "string") {
        setAiSecretId(d.secretId);
      }
    }
    aiDefaultsInitRef.current = true;
  }, [aiOpen, aiStep, settingsQuery.data?.settings]);

  const [publishSlug, setPublishSlug] = useState("");
  const [publishId, setPublishId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const [gallerySelectedSlug, setGallerySelectedSlug] = useState<string | null>(null);
  const selectedPublicQuery = usePublicToolset(gallerySelectedSlug);
  const [galleryDetailOpen, setGalleryDetailOpen] = useState(false);
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryShowJson, setGalleryShowJson] = useState(false);

  const [adoptSlug, setAdoptSlug] = useState<string | null>(null);
  const [adoptName, setAdoptName] = useState("");
  const [adoptDescription, setAdoptDescription] = useState("");
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
        header: t("toolsets.updatedAt"),
        accessorKey: "updatedAt",
        cell: ({ row }: any) => <span className="text-xs text-muted">{formatDateTime((row.original as Toolset).updatedAt)}</span>,
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
                  if (!scopedOrgId) return;
                  await updateSettings.mutateAsync({ toolsets: { defaultToolsetId: toolset.id } });
                  toast.success(t("common.saved"));
                }}
                disabled={!scopedOrgId || updateSettings.isPending}
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
                description={t("toolsets.confirmDeleteDescription")}
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
  const filteredGalleryItems = useMemo(() => {
    const q = gallerySearch.trim().toLowerCase();
    if (!q) return galleryItems;
    return galleryItems.filter((it) => (it.name ?? "").toLowerCase().includes(q) || (it.publicSlug ?? "").toLowerCase().includes(q));
  }, [galleryItems, gallerySearch]);

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("toolsets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("toolsets.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void toolsetsQuery.refetch();
            void galleryQuery.refetch();
            void settingsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("toolsets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("toolsets.subtitle")}</div>
        </div>
        <EmptyState
          title={t("org.requireActive")}
          action={
            <Button variant="accent" onClick={() => router.push(`/${locale}/org`)}>
              {t("onboarding.goOrg")}
            </Button>
          }
        />
      </div>
    );
  }

  const unauthorized =
    (toolsetsQuery.isError && isUnauthorizedError(toolsetsQuery.error)) ||
    (galleryQuery.isError && isUnauthorizedError(galleryQuery.error)) ||
    (settingsQuery.isError && isUnauthorizedError(settingsQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("toolsets.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("toolsets.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void toolsetsQuery.refetch();
            void galleryQuery.refetch();
            void settingsQuery.refetch();
          }}
        />
      </div>
    );
  }

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
              <CardDescription>{orgName ?? t("org.requireActive")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => toolsetsQuery.refetch()} disabled={!scopedOrgId}>
                  {t("common.refresh")}
                </Button>

                <ToolsetEditorDialog
                  title={t("toolsets.create")}
                  initial={emptyDraft()}
                  trigger={
                    <Button variant="accent" disabled={!scopedOrgId}>
                      {t("common.create")}
                    </Button>
                  }
                  onSave={async (draft) => {
                    if (!scopedOrgId) {
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

                <Button
                  variant="outline"
                  disabled={!scopedOrgId || toolsetsQuery.isError}
                  onClick={() => {
                    resetAiBuilder();
                    setAiOpen(true);
                  }}
                >
                  {t("toolsets.ai.generate")}
                </Button>

                {defaultToolsetId ? (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!scopedOrgId) return;
                      await updateSettings.mutateAsync({ toolsets: { defaultToolsetId: null } });
                      toast.success(t("common.saved"));
                    }}
                    disabled={!scopedOrgId || updateSettings.isPending}
                  >
                    {t("toolsets.clearDefault")}
                  </Button>
                ) : null}

                <div className="ml-auto text-xs text-muted">
                  {toolsetsQuery.isFetching ? t("common.loading") : t("toolsets.libraryCount", { count: toolsets.length })}
                </div>
              </div>

              <div className="mt-4">
                {toolsetsQuery.isLoading ? (
                  <EmptyState title={t("common.loading")} />
                ) : toolsetsQuery.isError ? (
                  <EmptyState title={t("toolsets.accessDeniedTitle")} description={t("toolsets.accessDeniedDescription")} />
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
              <CardDescription>{t("toolsets.galleryDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => galleryQuery.refetch()}>{t("common.refresh")}</Button>
                <div className="w-full md:ml-2 md:w-[320px]">
                  <Input
                    value={gallerySearch}
                    onChange={(e) => setGallerySearch(e.target.value)}
                    placeholder={t("toolsets.gallerySearchPlaceholder")}
                  />
                </div>
                <div className="ml-auto text-xs text-muted">
                  {galleryQuery.isFetching ? t("common.loading") : t("toolsets.galleryCount", { count: filteredGalleryItems.length })}
                </div>
              </div>

              <div className="mt-4">
                {galleryQuery.isLoading ? (
                  <EmptyState title={t("common.loading")} />
                ) : galleryItems.length === 0 ? (
                  <EmptyState title={t("toolsets.emptyGalleryTitle")} description={t("toolsets.emptyGalleryDescription")} />
                ) : filteredGalleryItems.length === 0 ? (
                  <EmptyState title={t("toolsets.emptyGallerySearchTitle")} description={t("toolsets.emptyGallerySearchDescription")} />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredGalleryItems.map((it) => (
                      <div key={it.publicSlug} className="rounded-lg border border-borderSubtle bg-panel/40 p-4 shadow-elev1">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-text">{it.name}</div>
                            <div className="mt-1 truncate font-mono text-xs text-muted">{it.publicSlug}</div>
                            {it.description ? <div className="mt-2 text-sm text-muted">{it.description}</div> : null}
                            <div className="mt-2 text-xs text-muted">
                              {t("toolsets.galleryCardCounts", { mcp: it.mcpServerCount, skills: it.agentSkillCount })}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setGallerySelectedSlug(it.publicSlug);
                                setGalleryShowJson(false);
                                setGalleryDetailOpen(true);
                              }}
                            >
                              {t("common.view")}
                            </Button>
                            <Button
                              size="sm"
                              variant="accent"
                              disabled={!scopedOrgId}
                              onClick={() => {
                                setAdoptSlug(it.publicSlug);
                                setAdoptName(t("toolsets.adoptDefaultName", { name: it.name }));
                                setAdoptDescription(it.description ?? "");
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

      <Dialog
        open={aiOpen}
        onOpenChange={(next) => {
          setAiOpen(next);
          if (!next) {
            resetAiBuilder();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("toolsets.ai.title")}</DialogTitle>
            <DialogDescription>{t("toolsets.ai.subtitle")}</DialogDescription>
          </DialogHeader>

          {(() => {
            const loading = createBuilderSession.isPending || chatBuilderSession.isPending || finalizeBuilderSession.isPending;

            if (aiStep === "start") {
              return (
                <div className="mt-3 grid gap-4">
                  <div className="grid gap-1.5">
                    <Label>{t("toolsets.ai.modelLabel")}</Label>
                    <LlmConfigField
                      orgId={scopedOrgId}
                      mode="toolsetBuilder"
                      value={{ providerId: aiProvider, modelId: aiModel, secretId: aiSecretId || null } as any}
                      onChange={(next) => {
                        setAiProvider(next.providerId);
                        setAiModel(next.modelId);
                        setAiSecretId(next.secretId ?? "");
                      }}
                      disabled={loading}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label>{t("toolsets.ai.intentLabel")}</Label>
                    <Textarea value={aiIntent} onChange={(e) => setAiIntent(e.target.value)} className="min-h-[140px]" />
                  </div>

                  <AdvancedSection
                    id="toolsets-ai-start-advanced"
                    title={t("advanced.title")}
                    description={t("advanced.description")}
                    labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
                  >
                    <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
                      {t("toolsets.ai.guardrail")}
                    </div>
                  </AdvancedSection>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAiOpen(false)} disabled={loading}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="accent"
                      disabled={loading || aiModel.trim().length === 0}
                      onClick={async () => {
                        try {
                          const intent = aiIntent.trim();
                          const res = await createBuilderSession.mutateAsync({
                            ...(intent.length > 0 ? { intent } : {}),
                            llm: {
                              provider: aiProvider,
                              model: aiModel.trim(),
                              ...(aiSecretId ? { auth: { secretId: aiSecretId } } : {}),
                            },
                          });
                          setAiSessionId(res.sessionId);
                          setAiAssistant(res.assistant.message);
                          setAiComponents(res.components);
                          setAiSelectedKeys(res.selectedComponentKeys);
                          setAiStep("chat");
                        } catch (err: any) {
                          toast.error(err?.message ?? t("common.error"));
                        }
                      }}
                    >
                      {t("toolsets.ai.start")}
                    </Button>
                  </div>
                </div>
              );
            }

            if (aiStep === "chat") {
              return (
                <div className="mt-3 grid gap-4">
                  <div className="grid gap-2 rounded-md border border-borderSubtle bg-panel/40 p-3">
                    <div className="text-sm font-medium text-text">{t("toolsets.ai.assistantLabel")}</div>
                    <div className="whitespace-pre-wrap text-sm text-muted">{aiAssistant || "-"}</div>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-sm font-medium text-text">{t("toolsets.ai.componentsLabel")}</div>
                    <div className="grid gap-2">
                      {aiComponents.map((c) => {
                        const checked = aiSelectedKeys.includes(c.key);
                        const secondary =
                          c.kind === "mcp"
                            ? `${t("toolsets.ai.kindMcp")} • ${c.mcp.name} (${c.mcp.transport})`
                            : `${t("toolsets.ai.kindSkill")} • ${c.skillTemplate.idHint}`;
                        return (
                          <label
                            key={c.key}
                            className="flex cursor-pointer items-start gap-3 rounded-md border border-borderSubtle bg-panel/30 p-3"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setAiSelectedKeys((prev) => (next ? Array.from(new Set([...prev, c.key])) : prev.filter((k) => k !== c.key)));
                              }}
                              className="mt-0.5 h-4 w-4 accent-[color:var(--color-accent)]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold text-text">{c.name}</div>
                                <div className="truncate text-xs text-muted">{secondary}</div>
                              </div>
                              {c.description ? <div className="mt-1 text-sm text-muted">{c.description}</div> : null}
                              {c.kind === "mcp" && (c.requiredEnv ?? []).length > 0 ? (
                                <div className="mt-2 text-xs text-muted">
                                  {t("toolsets.ai.requiredEnvLabel")}: <span className="font-mono">{(c.requiredEnv ?? []).join(", ")}</span>
                                </div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>{t("toolsets.ai.chatLabel")}</Label>
                    <Textarea value={aiChatMessage} onChange={(e) => setAiChatMessage(e.target.value)} className="min-h-[120px]" />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={loading || !aiSessionId || aiChatMessage.trim().length === 0}
                        onClick={async () => {
                          if (!aiSessionId) return;
                          const msg = aiChatMessage.trim();
                          try {
                            const res = await chatBuilderSession.mutateAsync({
                              sessionId: aiSessionId,
                              message: msg,
                              selectedComponentKeys: aiSelectedKeys,
                            });
                            setAiAssistant(res.assistant.message);
                            setAiComponents(res.components);
                            setAiSelectedKeys(res.selectedComponentKeys);
                            setAiChatMessage("");
                          } catch (err: any) {
                            toast.error(err?.message ?? t("common.error"));
                          }
                        }}
                      >
                        {t("toolsets.ai.send")}
                      </Button>
                      <Button
                        variant="accent"
                        disabled={loading || !aiSessionId}
                        onClick={async () => {
                          if (!aiSessionId) return;
                          try {
                            const res = await finalizeBuilderSession.mutateAsync({
                              sessionId: aiSessionId,
                              selectedComponentKeys: aiSelectedKeys,
                            });
                            setAiDraft(res.draft as any);
                            setAiWarnings(Array.isArray(res.warnings) ? res.warnings : []);
                            setAiStep("preview");
                          } catch (err: any) {
                            toast.error(err?.message ?? t("common.error"));
                          }
                        }}
                      >
                        {t("toolsets.ai.finalize")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            const draft = aiDraft as ToolsetDraft | null;
            if (!draft) {
              return (
                <div className="mt-3">
                  <EmptyState title={t("common.error")} description={t("toolsets.ai.noDraft")} />
                </div>
              );
            }

            return (
              <div className="mt-3 grid gap-4">
                {aiWarnings.length > 0 ? (
                  <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">
                    <div className="text-sm font-medium text-text">{t("toolsets.ai.warningsTitle")}</div>
                    <div className="mt-2 grid gap-1">
                      {aiWarnings.map((w, i) => (
                        <div key={i}>{w}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <div className="text-sm font-medium text-text">{t("toolsets.ai.previewTitle")}</div>
                  <CodeBlock value={draft} />
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setAiStep("chat")} disabled={loading}>
                    {t("common.back")}
                  </Button>

                  <ToolsetEditorDialog
                    title={t("toolsets.ai.openInEditor")}
                    initial={{
                      name: String((draft as any).name ?? ""),
                      description: String((draft as any).description ?? ""),
                      visibility: (draft as any).visibility === "org" ? "org" : "private",
                      mcpServers: Array.isArray((draft as any).mcpServers) ? ((draft as any).mcpServers as any) : [],
                      agentSkills: Array.isArray((draft as any).agentSkills) ? ((draft as any).agentSkills as any) : [],
                    }}
                    trigger={<Button variant="outline">{t("toolsets.ai.openInEditor")}</Button>}
                    onSave={async (d) => {
                      await createToolset.mutateAsync({
                        name: d.name,
                        description: d.description,
                        visibility: d.visibility,
                        mcpServers: d.mcpServers,
                        agentSkills: d.agentSkills,
                      });
                      toast.success(t("common.created"));
                      setAiOpen(false);
                    }}
                  />

                  <Button
                    variant="accent"
                    disabled={loading}
                    onClick={async () => {
                      await createToolset.mutateAsync({
                        name: draft.name,
                        description: draft.description,
                        visibility: draft.visibility,
                        mcpServers: draft.mcpServers,
                        agentSkills: draft.agentSkills,
                      });
                      toast.success(t("common.created"));
                      setAiOpen(false);
                    }}
                  >
                    {t("toolsets.ai.createToolset")}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("toolsets.publish")}</DialogTitle>
            <DialogDescription>{t("toolsets.publicSlug")}</DialogDescription>
          </DialogHeader>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("toolsets.publicSlug")}</Label>
              <Input value={publishSlug} onChange={(e) => setPublishSlug(e.target.value)} placeholder={t("toolsets.publicSlugPlaceholder")} />
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
            <DialogTitle>{t("toolsets.galleryDetailTitle")}</DialogTitle>
            <DialogDescription>{gallerySelectedSlug ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            {selectedPublicQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : selectedPublicQuery.data?.toolset ? (
              <div className="grid gap-4">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-text">{selectedPublicQuery.data.toolset.name}</div>
                    {selectedPublicQuery.data.toolset.description ? (
                      <div className="mt-1 text-sm text-muted">{selectedPublicQuery.data.toolset.description}</div>
                    ) : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setGalleryShowJson((v) => !v)}>
                    {galleryShowJson ? t("toolsets.hideJson") : t("toolsets.viewJson")}
                  </Button>
                </div>

                {galleryShowJson ? (
                  <CodeBlock value={selectedPublicQuery.data.toolset} />
                ) : (
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <div className="text-sm font-medium text-text">{t("toolsets.mcpServers")}</div>
                      {(selectedPublicQuery.data.toolset.mcpServers ?? []).length === 0 ? (
                        <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("toolsets.noMcpServers")}</div>
                      ) : (
                        <div className="grid gap-2">
                          {(selectedPublicQuery.data.toolset.mcpServers ?? []).map((s, idx) => {
                            const enabled = (s.enabled ?? true) !== false;
                            const envKeys = Object.keys(s.env ?? {});
                            const headerKeys = Object.keys(s.headers ?? {});
                            return (
                              <div key={`${s.name}-${idx}`} className="rounded-md border border-borderSubtle bg-panel/40 p-3">
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-text">
                                      {s.name}{" "}
                                      <span className="text-xs text-muted">
                                        ({s.transport}) {enabled ? t("toolsets.enabled") : t("toolsets.disabled")}
                                      </span>
                                    </div>
                                    <div className="mt-1 truncate font-mono text-xs text-muted">
                                      {s.transport === "stdio"
                                        ? `${s.command ?? ""}${Array.isArray(s.args) && s.args.length > 0 ? " " + s.args.join(" ") : ""}`
                                        : (s.url ?? "")}
                                    </div>
                                    {envKeys.length > 0 ? (
                                      <div className="mt-2 text-xs text-muted">
                                        {t("toolsets.details.envKeys")}: <span className="font-mono">{envKeys.join(", ")}</span>
                                      </div>
                                    ) : (
                                      <div className="mt-2 text-xs text-muted">{t("toolsets.details.envKeys")}: {t("toolsets.details.none")}</div>
                                    )}
                                    {headerKeys.length > 0 ? (
                                      <div className="mt-1 text-xs text-muted">
                                        {t("toolsets.details.headerKeys")}: <span className="font-mono">{headerKeys.join(", ")}</span>
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-xs text-muted">{t("toolsets.details.headerKeys")}: {t("toolsets.details.none")}</div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-2">
                      <div className="text-sm font-medium text-text">{t("toolsets.agentSkills")}</div>
                      {(selectedPublicQuery.data.toolset.agentSkills ?? []).length === 0 ? (
                        <div className="rounded-md border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("toolsets.noSkills")}</div>
                      ) : (
                        <div className="grid gap-2">
                          {(selectedPublicQuery.data.toolset.agentSkills ?? []).map((b, idx) => {
                            const enabled = (b.enabled ?? true) !== false;
                            const files = Array.isArray(b.files) ? b.files : [];
                            return (
                              <div key={`${b.id}-${idx}`} className="rounded-md border border-borderSubtle bg-panel/40 p-3">
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-text">
                                      {b.name}{" "}
                                      <span className="text-xs text-muted">
                                        ({b.id}) {enabled ? t("toolsets.enabled") : t("toolsets.disabled")}
                                      </span>
                                    </div>
                                    {b.description ? <div className="mt-1 text-sm text-muted">{b.description}</div> : null}
                                    <div className="mt-2 text-xs text-muted">
                                      {t("toolsets.details.fileCount", { count: files.length })}:{" "}
                                      <span className="font-mono">{files.map((f) => f.path).join(", ")}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
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
            <div className="grid gap-1.5">
              <Label>{t("toolsets.description")}</Label>
              <Textarea
                value={adoptDescription}
                onChange={(e) => setAdoptDescription(e.target.value)}
                placeholder={t("toolsets.adoptDescriptionPlaceholder")}
                className="min-h-[90px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdoptOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="accent"
                onClick={async () => {
                  if (!scopedOrgId || !adoptSlug) return;
                  await adoptToolset.mutateAsync({
                    publicSlug: adoptSlug,
                    name: adoptName.trim(),
                    ...(adoptDescription.trim().length > 0 ? { description: adoptDescription.trim() } : {}),
                  });
                  toast.success(t("common.created"));
                  setAdoptOpen(false);
                }}
                disabled={!scopedOrgId || adoptToolset.isPending || !adoptSlug || adoptName.trim().length === 0}
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
