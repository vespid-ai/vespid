import path from "node:path";
import { z } from "zod";

export const skillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeRelativePath(p: string): boolean {
  if (p.length === 0) {
    return false;
  }
  if (path.isAbsolute(p)) {
    return false;
  }
  const normalized = path.normalize(p);
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
    return false;
  }
  return true;
}

export const skillManifestSchema = z.object({
  id: skillIdSchema,
  version: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  entrypoint: z
    .string()
    .min(1)
    .max(200)
    .refine((p) => isSafeRelativePath(p), { message: "entrypoint must be a safe relative path" }),
  runtime: z.enum(["shell", "node"]),
  inputSchema: z.unknown().refine((v) => isPlainObject(v), { message: "inputSchema must be a JSON object" }),
  outputMode: z.enum(["text", "json"]),
  sandbox: z
    .object({
      backend: z.enum(["docker", "host", "provider"]).optional(),
      network: z.enum(["none", "enabled"]).optional(),
      timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
      docker: z.object({ image: z.string().min(1).max(200).optional() }).optional(),
      envPassthroughAllowlist: z.array(z.string().min(1).max(120)).max(50).optional(),
    })
    .default({}),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export type LoadedSkill = {
  id: string;
  dirPath: string;
  manifest: SkillManifest;
  doc?: string | null;
};

