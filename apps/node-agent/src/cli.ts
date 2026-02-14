import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { startNodeAgent, type NodeAgentConfig } from "./runtime.js";

function defaultConfigPath(): string {
  return path.join(os.homedir(), ".vespid", "agent.json");
}

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i += 1) {
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
    configPath: z.string().min(1).optional(),
  }),
  z.object({
    command: z.literal("start"),
    configPath: z.string().min(1).optional(),
  }),
]);

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const command = argv[2] === "connect" ? "connect" : "start";
  const flags = parseFlags(argv);
  if (command === "connect") {
    return argsSchema.parse({
      command,
      pairingToken: flags["pairing-token"],
      apiBase: flags["api-base"] ?? "http://localhost:3001",
      name: flags["name"],
      configPath: flags["config-path"],
    });
  }
  return argsSchema.parse({
    command,
    configPath: flags["config-path"],
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
}): Promise<Pick<NodeAgentConfig, "agentId" | "agentToken" | "organizationId" | "gatewayWsUrl">> {
  const url = new URL("/v1/agents/pair", input.apiBaseUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingToken: input.pairingToken,
      name: input.name,
      agentVersion: input.agentVersion,
      capabilities: {
        kinds: ["connector.action", "agent.execute"],
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
      agentId: z.string().uuid(),
      agentToken: z.string().min(1),
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
    });

    const config: NodeAgentConfig = {
      agentId: paired.agentId,
      agentToken: paired.agentToken,
      organizationId: paired.organizationId,
      gatewayWsUrl: paired.gatewayWsUrl,
      apiBaseUrl: parsed.apiBase,
      name,
      agentVersion,
      capabilities: { kinds: ["connector.action", "agent.execute"] },
    };

    await saveConfig(configPath, config);
    const started = await startNodeAgent(config);
    await started.ready;
    return;
  }

  const configPath = parsed.configPath ?? defaultConfigPath();
  const config = await loadConfig(configPath);
  const started = await startNodeAgent(config);
  await started.ready;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

