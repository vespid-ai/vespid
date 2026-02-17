import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { MemoryProvider } from "@vespid/shared";

export type MemorySearchResult = {
  path: string;
  snippet: string;
  lineStart: number;
  lineEnd: number;
  score: number;
};

export type MemoryGetResult = {
  path: string;
  text: string;
  lineStart: number;
  lineEnd: number;
};

export type MemoryManager = {
  provider: MemoryProvider;
  sync: () => Promise<void>;
  search: (input: { query: string; maxResults?: number }) => Promise<MemorySearchResult[]>;
  get: (input: { filePath: string; fromLine?: number; lineCount?: number }) => Promise<MemoryGetResult>;
  status: () => { provider: MemoryProvider; fallbackFrom?: MemoryProvider; lastError?: string | null };
};

type IndexedFile = {
  relativePath: string;
  absolutePath: string;
  lines: string[];
};

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_\-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function scoreLine(line: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const lower = line.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      score += 1;
    }
  }
  return score;
}

async function listMemoryFiles(workspaceDir: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const out: Array<{ absolutePath: string; relativePath: string }> = [];

  const main = path.join(workspaceDir, "MEMORY.md");
  try {
    const stat = await fs.stat(main);
    if (stat.isFile()) {
      out.push({ absolutePath: main, relativePath: "MEMORY.md" });
    }
  } catch {
    // ignore
  }

  const memoryDir = path.join(workspaceDir, "memory");
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      out.push({
        absolutePath,
        relativePath: path.relative(workspaceDir, absolutePath).replace(/\\/g, "/"),
      });
    }
  }

  await walk(memoryDir);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function createBuiltinMemoryManager(input: { workspaceDir: string }): MemoryManager {
  let indexedFiles: IndexedFile[] = [];
  let synced = false;

  async function sync(): Promise<void> {
    const files = await listMemoryFiles(input.workspaceDir);
    const next: IndexedFile[] = [];
    for (const file of files) {
      let text = "";
      try {
        text = await fs.readFile(file.absolutePath, "utf8");
      } catch {
        continue;
      }
      next.push({
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        lines: text.split(/\r?\n/),
      });
    }
    indexedFiles = next;
    synced = true;
  }

  async function ensureSync(): Promise<void> {
    if (!synced) {
      await sync();
    }
  }

  return {
    provider: "builtin",
    sync,
    async search(params): Promise<MemorySearchResult[]> {
      await ensureSync();
      const terms = tokenize(params.query);
      const maxResults = clampInt(params.maxResults, 8, 1, 50);
      if (terms.length === 0) {
        return [];
      }

      const candidates: MemorySearchResult[] = [];
      for (const file of indexedFiles) {
        for (let i = 0; i < file.lines.length; i += 1) {
          const line = file.lines[i] ?? "";
          const score = scoreLine(line, terms);
          if (score <= 0) {
            continue;
          }
          const start = Math.max(1, i + 1 - 1);
          const end = Math.min(file.lines.length, i + 1 + 1);
          const snippet = file.lines.slice(start - 1, end).join("\n").trim();
          candidates.push({
            path: file.relativePath,
            snippet,
            lineStart: start,
            lineEnd: end,
            score,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.lineStart - b.lineStart);
      return candidates.slice(0, maxResults);
    },
    async get(params): Promise<MemoryGetResult> {
      await ensureSync();
      const target = indexedFiles.find((file) => file.relativePath === params.filePath) ?? null;
      if (!target) {
        throw new Error(`MEMORY_FILE_NOT_FOUND:${params.filePath}`);
      }
      const fromLine = clampInt(params.fromLine, 1, 1, Math.max(1, target.lines.length));
      const lineCount = clampInt(params.lineCount, 80, 1, 500);
      const toLine = Math.min(target.lines.length, fromLine + lineCount - 1);
      return {
        path: target.relativePath,
        text: target.lines.slice(fromLine - 1, toLine).join("\n"),
        lineStart: fromLine,
        lineEnd: toLine,
      };
    },
    status() {
      return { provider: "builtin", lastError: null };
    },
  };
}

function runCommand(args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const command = args[0];
    if (!command) {
      reject(new Error("QMD_COMMAND_REQUIRED"));
      return;
    }
    const child = spawn(command, args.slice(1), {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`QMD_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`QMD_EXIT_${code}:${stderr || stdout}`));
    });
  });
}

export function createQmdMemoryManager(input: {
  workspaceDir: string;
  command?: string;
  timeoutMs?: number;
}): MemoryManager {
  const command = (input.command ?? process.env.VESPID_QMD_COMMAND ?? "qmd").trim();
  const timeoutMs = clampInt(input.timeoutMs, 20_000, 1000, 120_000);
  let lastError: string | null = null;

  return {
    provider: "qmd",
    async sync(): Promise<void> {
      try {
        await runCommand([command, "update"], input.workspaceDir, timeoutMs);
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw new Error(`QMD_UNAVAILABLE:${lastError}`);
      }
    },
    async search(params): Promise<MemorySearchResult[]> {
      try {
        const query = params.query.trim();
        const limit = clampInt(params.maxResults, 8, 1, 50);
        const { stdout } = await runCommand([command, "query", query, "--limit", String(limit), "--json"], input.workspaceDir, timeoutMs);
        const parsed = JSON.parse(stdout) as unknown;
        if (!Array.isArray(parsed)) {
          return [];
        }
        const out: MemorySearchResult[] = [];
        for (const row of parsed) {
          if (!row || typeof row !== "object") {
            continue;
          }
          const item = row as Record<string, unknown>;
          if (typeof item.path !== "string") {
            continue;
          }
          out.push({
            path: item.path,
            snippet: typeof item.snippet === "string" ? item.snippet : "",
            lineStart: typeof item.lineStart === "number" ? item.lineStart : 1,
            lineEnd: typeof item.lineEnd === "number" ? item.lineEnd : 1,
            score: typeof item.score === "number" ? item.score : 0,
          });
        }
        lastError = null;
        return out;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw new Error(`QMD_UNAVAILABLE:${lastError}`);
      }
    },
    async get(params): Promise<MemoryGetResult> {
      const builtin = createBuiltinMemoryManager({ workspaceDir: input.workspaceDir });
      await builtin.sync();
      return await builtin.get({
        filePath: params.filePath,
        ...(typeof params.fromLine === "number" ? { fromLine: params.fromLine } : {}),
        ...(typeof params.lineCount === "number" ? { lineCount: params.lineCount } : {}),
      });
    },
    status() {
      return { provider: "qmd", ...(lastError ? { lastError } : {}) };
    },
  };
}

export function createMemoryManager(input: {
  provider: MemoryProvider;
  workspaceDir: string;
  qmdCommand?: string;
  qmdTimeoutMs?: number;
}): MemoryManager {
  if (input.provider === "builtin") {
    return createBuiltinMemoryManager({ workspaceDir: input.workspaceDir });
  }

  const qmd = createQmdMemoryManager({
    workspaceDir: input.workspaceDir,
    ...(input.qmdCommand ? { command: input.qmdCommand } : {}),
    ...(input.qmdTimeoutMs ? { timeoutMs: input.qmdTimeoutMs } : {}),
  });
  const builtin = createBuiltinMemoryManager({ workspaceDir: input.workspaceDir });
  let fallbackFrom: MemoryProvider | undefined;
  let lastError: string | null = null;

  return {
    provider: "qmd",
    async sync() {
      try {
        await qmd.sync();
        return;
      } catch (error) {
        fallbackFrom = "qmd";
        lastError = error instanceof Error ? error.message : String(error);
      }
      await builtin.sync();
    },
    async search(params) {
      try {
        return await qmd.search(params);
      } catch (error) {
        fallbackFrom = "qmd";
        lastError = error instanceof Error ? error.message : String(error);
      }
      return await builtin.search(params);
    },
    async get(params) {
      try {
        return await qmd.get(params);
      } catch (error) {
        fallbackFrom = "qmd";
        lastError = error instanceof Error ? error.message : String(error);
      }
      return await builtin.get(params);
    },
    status() {
      return {
        provider: fallbackFrom ? "builtin" : "qmd",
        ...(fallbackFrom ? { fallbackFrom } : {}),
        ...(lastError ? { lastError } : {}),
      };
    },
  };
}
