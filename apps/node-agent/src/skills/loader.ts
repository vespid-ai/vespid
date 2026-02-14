import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { skillIdSchema, skillManifestSchema, type LoadedSkill } from "./types.js";
import { assertSubpath, resolveHome } from "../sandbox/util.js";

function defaultSkillsDir(): string {
  const raw = process.env.VESPID_AGENT_SKILLS_DIR ?? "~/.vespid/skills";
  return resolveHome(raw);
}

async function safeReadText(filePath: string, maxChars: number): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.length <= maxChars ? raw : raw.slice(0, maxChars);
  } catch {
    return null;
  }
}

export async function loadSkillsRegistry(input?: {
  skillsDir?: string;
  maxDocChars?: number;
}): Promise<{ skillsDir: string; skills: Record<string, LoadedSkill> }> {
  const skillsDir = input?.skillsDir ?? defaultSkillsDir();
  const maxDocChars = Math.max(0, Math.min(500_000, input?.maxDocChars ?? 200_000));

  const resolvedRoot = path.resolve(skillsDir);
  const skills: Record<string, LoadedSkill> = {};

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return { skillsDir, skills };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!skillIdSchema.safeParse(entry.name).success) {
      continue;
    }

    const dirPath = path.join(skillsDir, entry.name);
    const resolvedDir = path.resolve(dirPath);
    try {
      assertSubpath(resolvedRoot, resolvedDir);
    } catch {
      continue;
    }

    const manifestPath = path.join(dirPath, "skill.json");
    let manifestRaw: string;
    try {
      manifestRaw = await fs.readFile(manifestPath, "utf8");
    } catch {
      continue;
    }

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw) as unknown;
    } catch {
      continue;
    }

    const parsed = skillManifestSchema.safeParse(manifestJson);
    if (!parsed.success) {
      continue;
    }
    if (parsed.data.id !== entry.name) {
      continue;
    }

    // Validate entrypoint resolves within skill dir.
    const resolvedEntrypoint = path.resolve(dirPath, parsed.data.entrypoint);
    try {
      assertSubpath(resolvedDir, resolvedEntrypoint);
    } catch {
      continue;
    }

    const docPath = path.join(dirPath, "SKILL.md");
    const doc = await safeReadText(docPath, maxDocChars);

    skills[parsed.data.id] = {
      id: parsed.data.id,
      dirPath,
      manifest: parsed.data,
      doc,
    };
  }

  return { skillsDir, skills };
}
