import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { startNodeAgent, type NodeAgentConfig } from "./runtime.js";

function defaultConfigPath(): string {
  return path.join(os.homedir(), ".vespid", "agent.json");
}

function locateCommandIndex(argv: string[]): number {
  // tsx watch typically inserts a `--` separator before script args, so the command
  // may not be at argv[2]. We scan for the first recognized command token.
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || token === "--") {
      continue;
    }
    if (token === "connect" || token === "start") {
      return i;
    }
  }
  return -1;
}

function parseFlags(argv: string[], startIndex: number): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = startIndex; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key || !key.startsWith("--")) {
      continue;
    }
    const name = key.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      flags[name] = "true";
      continue;
    }
    flags[name] = value;
    i += 1;
  }
  return flags;
}

const argsSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("connect"),
    pairingToken: z.string().min(1),
    apiBase: z.string().url().default("http://localhost:3001"),
    name: z.string().min(1).max(120).optional(),
    tags: z.array(z.string().min(1).max(64)).max(50).optional(),
    configPath: z.string().min(1).optional(),
  }),
  z.object({
    command: z.literal("start"),
    configPath: z.string().min(1).optional(),
    pool: z.enum(["managed", "byon"]).optional(),
    executorId: z.string().uuid().optional(),
    executorToken: z.string().min(1).optional(),
    organizationId: z.string().uuid().optional(),
    gatewayWsUrl: z.string().url().optional(),
    apiBase: z.string().url().optional(),
    name: z.string().min(1).max(120).optional(),
    labels: z.array(z.string().min(1).max(64)).max(50).optional(),
    maxInFlight: z.number().int().min(1).max(200).optional(),
  }),
]);

function parseCsvList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const commandIndex = locateCommandIndex(argv);
  const command = commandIndex >= 0 && argv[commandIndex] === "connect" ? "connect" : "start";
  const flags = parseFlags(argv, commandIndex >= 0 ? commandIndex + 1 : 3);
  if (command === "connect") {
    return argsSchema.parse({
      command,
      pairingToken: flags["pairing-token"],
      apiBase: flags["api-base"] ?? "http://localhost:3001",
      name: flags["name"],
      tags: parseCsvList(flags["tags"] ?? process.env.VESPID_AGENT_TAGS),
      configPath: flags["config-path"],
    });
  }
  return argsSchema.parse({
    command,
    configPath: flags["config-path"],
    pool: flags["pool"] as "managed" | "byon" | undefined,
    executorId: flags["executor-id"],
    executorToken: flags["executor-token"],
    organizationId: flags["organization-id"],
    gatewayWsUrl: flags["gateway-ws-url"],
    apiBase: flags["api-base"],
    name: flags["name"],
    labels: parseCsvList(flags["labels"] ?? flags["tags"] ?? process.env.VESPID_AGENT_TAGS),
    maxInFlight:
      typeof flags["max-in-flight"] === "string" && flags["max-in-flight"].trim().length > 0
        ? Number(flags["max-in-flight"])
        : undefined,
  });
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const raw = await fs.readFile(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function saveConfig(configPath: string, config: NodeAgentConfig): Promise<void> {
  await ensureDir(configPath);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function loadConfig(configPath: string): Promise<NodeAgentConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as NodeAgentConfig;
  return parsed;
}

async function pairAgent(input: {
  apiBaseUrl: string;
  pairingToken: string;
  name: string;
  agentVersion: string;
  tags?: string[];
}): Promise<{ executorId: string; executorToken: string; organizationId: string; gatewayWsUrl: string }> {
  const url = new URL("/v1/executors/pair", input.apiBaseUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingToken: input.pairingToken,
        name: input.name,
        agentVersion: input.agentVersion,
          capabilities: {
          kinds: ["connector.action", "agent.execute", "agent.run"],
          ...(input.tags && input.tags.length > 0 ? { labels: input.tags } : {}),
        },
      }),
    });
  const payload = await response.json();
  if (!response.ok) {
    const code = (payload as { code?: unknown }).code;
    throw new Error(typeof code === "string" ? code : "PAIRING_FAILED");
  }
  const parsed = z
    .object({
      executorId: z.string().uuid(),
      executorToken: z.string().min(1),
      organizationId: z.string().uuid(),
      gatewayWsUrl: z.string().min(1),
    })
    .parse(payload);
  return parsed;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === "connect") {
    const configPath = parsed.configPath ?? defaultConfigPath();
    const agentVersion = await readPackageVersion();
    const name = parsed.name ?? os.hostname() ?? `agent-${crypto.randomBytes(4).toString("hex")}`;

    const paired = await pairAgent({
      apiBaseUrl: parsed.apiBase,
      pairingToken: parsed.pairingToken,
      name,
      agentVersion,
      ...(parsed.tags ? { tags: parsed.tags } : {}),
    });

    const config: NodeAgentConfig = {
      pool: "byon",
      executorId: paired.executorId,
      executorToken: paired.executorToken,
      organizationId: paired.organizationId,
      gatewayWsUrl: paired.gatewayWsUrl,
      apiBaseUrl: parsed.apiBase,
      executorName: name,
      executorVersion: agentVersion,
      capabilities: {
        kinds: ["connector.action", "agent.execute", "agent.run"],
        ...(parsed.tags && parsed.tags.length > 0 ? { labels: parsed.tags } : {}),
      },
    };

    await saveConfig(configPath, config);
    const started = await startNodeAgent(config);
    await started.ready;
    return;
  }

  const configPath = parsed.configPath ?? defaultConfigPath();
  const preconfigured =
    parsed.executorId && parsed.executorToken && parsed.gatewayWsUrl
      ? ({
          pool: parsed.pool ?? "managed",
          executorId: parsed.executorId,
          executorToken: parsed.executorToken,
          ...(parsed.organizationId ? { organizationId: parsed.organizationId } : {}),
          gatewayWsUrl: parsed.gatewayWsUrl,
          apiBaseUrl: parsed.apiBase ?? process.env.VESPID_API_BASE ?? "http://localhost:3001",
          executorName: parsed.name ?? os.hostname() ?? `executor-${crypto.randomBytes(4).toString("hex")}`,
          executorVersion: await readPackageVersion(),
          capabilities: {
            kinds: ["connector.action", "agent.execute", "agent.run"],
            ...(parsed.labels && parsed.labels.length > 0 ? { labels: parsed.labels } : {}),
            ...(typeof parsed.maxInFlight === "number" && Number.isFinite(parsed.maxInFlight)
              ? { maxInFlight: Math.max(1, Math.floor(parsed.maxInFlight)) }
              : {}),
          },
        } satisfies NodeAgentConfig)
      : null;
  const config = preconfigured ?? (await loadConfig(configPath));
  const started = await startNodeAgent(config);
  await started.ready;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
