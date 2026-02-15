import { z } from "zod";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function safeTruncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

const agentSkillBundleSchema = z.object({
  format: z.literal("agentskills-v1"),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  files: z.array(
    z.object({
      path: z.string().min(1).max(200),
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]).optional(),
    })
  ),
});

function decodeSkillMd(bundle: z.infer<typeof agentSkillBundleSchema>, maxChars: number): string | null {
  const file = bundle.files.find((f) => f.path === "SKILL.md") ?? null;
  if (!file) return null;
  try {
    const enc = file.encoding ?? "utf8";
    const raw = enc === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
    return safeTruncate(raw, maxChars);
  } catch {
    return null;
  }
}

export function buildToolsetSkillsContext(input: {
  toolsetId: string;
  toolsetName: string;
  agentSkills: unknown;
}): { count: number; text: string } | null {
  const maxBundles = Math.max(0, Math.min(32, envInt("TOOLSET_SKILLS_MAX_BUNDLES", 8)));
  const maxCharsPerBundle = Math.max(1000, Math.min(200_000, envInt("TOOLSET_SKILLS_MAX_CHARS_PER_BUNDLE", 20_000)));
  const maxTotalChars = Math.max(5000, Math.min(1_000_000, envInt("TOOLSET_SKILLS_MAX_TOTAL_CHARS", 80_000)));

  const rawList = Array.isArray(input.agentSkills) ? (input.agentSkills as unknown[]) : [];
  const bundles: Array<z.infer<typeof agentSkillBundleSchema>> = [];
  for (const raw of rawList) {
    const parsed = agentSkillBundleSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (parsed.data.enabled === false) continue;
    bundles.push(parsed.data);
    if (bundles.length >= maxBundles) break;
  }

  let used = 0;
  const parts: string[] = [];
  for (const bundle of bundles) {
    const md = decodeSkillMd(bundle, maxCharsPerBundle);
    if (!md) continue;
    const header = `### ${bundle.name} (${bundle.id})\n`;
    const body = md.trim().length ? md.trim() + "\n" : "";
    const block = header + body;
    if (used + block.length > maxTotalChars) {
      const remaining = Math.max(0, maxTotalChars - used);
      if (remaining < 200) break;
      parts.push(safeTruncate(block, remaining));
      used = maxTotalChars;
      break;
    }
    parts.push(block);
    used += block.length;
  }

  if (parts.length === 0) {
    return null;
  }

  const text =
    [
      "Toolset Skills (read-only context)",
      `Toolset: ${input.toolsetName} (${input.toolsetId})`,
      "These docs are provided as context only. Do not assume you can execute them as tools unless explicitly allowed.",
      "",
      ...parts,
    ].join("\n");

  return { count: parts.length, text };
}

