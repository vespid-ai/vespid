import fs from "node:fs/promises";

// MCP is intentionally not enabled by default yet. This loader is "plumbing-only":
// it lets us validate wiring without changing runtime behavior.
export async function loadMcpConfigFromEnv(): Promise<{ ok: true; config: unknown } | { ok: false; error: string }> {
  const p = process.env.VESPID_AGENT_MCP_CONFIG;
  if (!p || p.trim().length === 0) {
    return { ok: true, config: null };
  }
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return { ok: false, error: "MCP_CONFIG_READ_FAILED" };
  }
  try {
    return { ok: true, config: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: "MCP_CONFIG_INVALID_JSON" };
  }
}

