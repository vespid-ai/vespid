import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryManager } from "./memory.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("memory manager", () => {
  it("indexes MEMORY.md and memory/*.md using builtin provider", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vespid-memory-"));
    tempDirs.push(workspace);
    await fs.mkdir(path.join(workspace, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Roadmap: ship runtime v2\n", "utf8");
    await fs.writeFile(path.join(workspace, "memory", "2026-02-16.md"), "Pinned node-host required\n", "utf8");

    const manager = createMemoryManager({ provider: "builtin", workspaceDir: workspace });
    await manager.sync();

    const results = await manager.search({ query: "pinned node-host" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toBe("memory/2026-02-16.md");

    const read = await manager.get({ filePath: "MEMORY.md" });
    expect(read.text).toContain("runtime v2");
  });

  it("falls back to builtin when qmd is unavailable", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vespid-memory-fallback-"));
    tempDirs.push(workspace);
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "fallback check", "utf8");

    const manager = createMemoryManager({
      provider: "qmd",
      workspaceDir: workspace,
      qmdCommand: "qmd-not-found",
      qmdTimeoutMs: 1000,
    });

    const results = await manager.search({ query: "fallback" });
    expect(results.length).toBeGreaterThan(0);
    const status = manager.status();
    expect(status.provider).toBe("builtin");
    expect(status.fallbackFrom).toBe("qmd");
  });
});
