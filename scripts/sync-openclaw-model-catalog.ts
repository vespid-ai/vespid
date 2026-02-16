import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeLlmProviderId,
  type LlmCatalogTag,
  type LlmModelCatalogEntry,
  type LlmModelCatalogSnapshot,
} from "../packages/shared/src/llm/provider-registry.js";

const execFileAsync = promisify(execFile);

const DEFAULT_OPENCLAW_ROOT = "/Users/mangaohua/src/openclaw";
const SNAPSHOT_PATH = path.resolve("packages/shared/src/llm/model-catalog.snapshot.json");

type OpenClawCatalogEntry = {
  id?: string;
  name?: string;
  provider?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
};

function inferTags(entry: OpenClawCatalogEntry): LlmCatalogTag[] {
  const tags = new Set<LlmCatalogTag>();
  const modelId = String(entry.id ?? "").toLowerCase();
  if (entry.reasoning || modelId.includes("thinking")) tags.add("reasoning");
  if (Array.isArray(entry.input) && entry.input.includes("image")) tags.add("vision");
  if (modelId.includes("mini") || modelId.includes("flash") || modelId.includes("lite") || modelId.includes("turbo")) tags.add("fast");
  if (modelId.includes("code") || modelId.includes("coder") || modelId.includes("codex") || modelId.includes("claude") || modelId.includes("gpt")) {
    tags.add("coding");
  }
  return Array.from(tags);
}

function toSnapshotModels(entries: OpenClawCatalogEntry[]): LlmModelCatalogEntry[] {
  const out: LlmModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const providerId = normalizeLlmProviderId(typeof raw.provider === "string" ? raw.provider : null);
    const modelId = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!providerId || !modelId) continue;
    const key = `${providerId}:${modelId.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : modelId;
    const tags = inferTags(raw);
    out.push({
      providerId,
      modelId,
      name,
      ...(tags.length > 0 ? { tags } : {}),
    });
  }
  out.sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
  return out;
}

async function readOpenClawCommit(openclawRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: openclawRoot });
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function loadFromOpenClaw(openclawRoot: string): Promise<OpenClawCatalogEntry[]> {
  const evalScript = [
    "import { loadModelCatalog } from './src/agents/model-catalog.ts';",
    "(async () => {",
    "  const out = await loadModelCatalog({ useCache: false });",
    "  console.log(JSON.stringify(out));",
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");

  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "--eval", evalScript], {
    cwd: openclawRoot,
    maxBuffer: 20 * 1024 * 1024,
  });

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lastJson = lines.reverse().find((line) => line.startsWith("["));
  if (!lastJson) return [];
  try {
    const parsed = JSON.parse(lastJson) as unknown;
    return Array.isArray(parsed) ? (parsed as OpenClawCatalogEntry[]) : [];
  } catch {
    return [];
  }
}

async function run() {
  const openclawRoot = path.resolve(process.argv[2] ?? process.env.OPENCLAW_ROOT ?? DEFAULT_OPENCLAW_ROOT);
  const commit = await readOpenClawCommit(openclawRoot);
  const discovered = await loadFromOpenClaw(openclawRoot);
  if (discovered.length === 0) {
    throw new Error(`No models discovered from OpenClaw at ${openclawRoot}`);
  }

  const models = toSnapshotModels(discovered);
  if (models.length === 0) {
    throw new Error("Discovered catalog did not match Vespid provider registry");
  }

  const payload: LlmModelCatalogSnapshot = {
    version: 1,
    source: {
      kind: "openclaw-snapshot",
      sourceRepo: "openclaw",
      sourceCommit: commit,
      generatedAt: new Date().toISOString(),
    },
    models,
  };

  await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Updated ${SNAPSHOT_PATH} with ${models.length} models from ${openclawRoot}\n`);
}

run().catch((error) => {
  process.stderr.write(`sync-openclaw-model-catalog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
