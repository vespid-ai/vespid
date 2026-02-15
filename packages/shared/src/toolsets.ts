export type ToolsetVisibility = "private" | "org" | "public";

export type McpServerTransport = "stdio" | "http";

export type McpServerConfig = {
  // Server id (also used as MCP server name). Must be stable and URL-safe.
  name: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  description?: string;
};

export type AgentSkillFile = {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
};

export type AgentSkillBundle = {
  format: "agentskills-v1";
  id: string;
  name: string;
  description?: string;
  entry: "SKILL.md";
  files: AgentSkillFile[];
  enabled?: boolean;
  optionalDirs?: {
    scripts?: boolean;
    references?: boolean;
    assets?: boolean;
  };
};

export type Toolset = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  visibility: ToolsetVisibility;
  publicSlug: string | null;
  mcpServers: McpServerConfig[];
  agentSkills: AgentSkillBundle[];
  adoptedFrom?: { toolsetId: string; publicSlug: string | null } | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
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

const ENV_PLACEHOLDER_RE = /^\$\{ENV:([A-Z0-9_]{1,128})\}$/;
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const MCP_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export function isEnvPlaceholder(value: string): boolean {
  return ENV_PLACEHOLDER_RE.test(value);
}

export function extractEnvPlaceholderName(value: string): string | null {
  const m = ENV_PLACEHOLDER_RE.exec(value);
  return m ? m[1] ?? null : null;
}

function isSafeRelativePath(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  if (p.includes("\0")) return false;
  if (p.startsWith("/")) return false;
  if (p.startsWith("\\")) return false;
  // Disallow Windows drive prefixes like C:\.
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  // Normalize: disallow path traversal.
  const parts = p.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) return false;
  // Keep it simple: forbid backslashes to avoid mixed separators.
  if (p.includes("\\")) return false;
  return true;
}

export function validateMcpPlaceholderPolicy(
  mcpServers: unknown
): { ok: true } | { ok: false; error: "INVALID_MCP_PLACEHOLDER"; detail: string } {
  const list = Array.isArray(mcpServers) ? (mcpServers as unknown[]) : [];
  for (const serverRaw of list) {
    const server = serverRaw as Partial<McpServerConfig>;
    if (!server || typeof server !== "object") {
      return { ok: false, error: "INVALID_MCP_PLACEHOLDER", detail: "mcpServers must be objects" };
    }
    if (!MCP_NAME_RE.test(String(server.name ?? ""))) {
      return { ok: false, error: "INVALID_MCP_PLACEHOLDER", detail: `invalid mcp server name: ${String(server.name ?? "")}` };
    }
    const env = server.env ?? {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v !== "string" || !isEnvPlaceholder(v)) {
        return { ok: false, error: "INVALID_MCP_PLACEHOLDER", detail: `env.${k} must be \${ENV:VAR}` };
      }
    }
    const headers = server.headers ?? {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v !== "string" || !isEnvPlaceholder(v)) {
        return { ok: false, error: "INVALID_MCP_PLACEHOLDER", detail: `headers.${k} must be \${ENV:VAR}` };
      }
    }
  }
  return { ok: true };
}

export function validateAgentSkillBundles(
  bundles: unknown
): { ok: true } | { ok: false; error: "INVALID_SKILL_BUNDLE"; detail: string } {
  const list = Array.isArray(bundles) ? (bundles as unknown[]) : [];
  for (const bundleRaw of list) {
    const bundle = bundleRaw as Partial<AgentSkillBundle>;
    if (!bundle || typeof bundle !== "object") {
      return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: "agentSkills must be objects" };
    }
    if (bundle.format !== "agentskills-v1") {
      return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: "unsupported skill bundle format" };
    }
    if (!SKILL_ID_RE.test(String(bundle.id ?? ""))) {
      return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `invalid skill id: ${String(bundle.id ?? "")}` };
    }
    const files = Array.isArray(bundle.files) ? (bundle.files as unknown[]) : [];
    const hasSkillMd = files.some((f) => f && typeof f === "object" && (f as any).path === "SKILL.md");
    if (!hasSkillMd) {
      return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `skill ${bundle.id} missing SKILL.md` };
    }
    for (const fileRaw of files) {
      const file = fileRaw as Partial<AgentSkillFile>;
      if (!file || typeof file !== "object") {
        return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `skill ${bundle.id} has invalid file entry` };
      }
      if (!isSafeRelativePath(String(file.path ?? ""))) {
        return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `skill ${bundle.id} invalid file path: ${String(file.path ?? "")}` };
      }
      if (typeof file.content !== "string") {
        return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `skill ${bundle.id} file ${file.path} content must be string` };
      }
      const enc = file.encoding ?? "utf8";
      if (enc !== "utf8" && enc !== "base64") {
        return { ok: false, error: "INVALID_SKILL_BUNDLE", detail: `skill ${bundle.id} file ${file.path} invalid encoding` };
      }
    }
  }
  return { ok: true };
}
