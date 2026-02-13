import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import WebSocket from "ws";
import { getCommunityConnectorAction } from "@vespid/connectors";
import type { ConnectorId } from "@vespid/connectors";
import type { GatewayAgentHelloMessage, GatewayAgentPingMessage, GatewayServerExecuteMessage } from "@vespid/shared";

type AgentConfig = {
  agentId: string;
  agentToken: string;
  organizationId: string;
  gatewayWsUrl: string;
  apiBaseUrl: string;
  name: string;
  agentVersion: string;
  capabilities: Record<string, unknown>;
};

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

async function saveConfig(configPath: string, config: AgentConfig): Promise<void> {
  await ensureDir(configPath);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function loadConfig(configPath: string): Promise<AgentConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as AgentConfig;
  return parsed;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

async function connectGateway(config: AgentConfig): Promise<void> {
  const ws = new WebSocket(config.gatewayWsUrl, {
    headers: {
      authorization: `Bearer ${config.agentToken}`,
    },
  });

  const hello: GatewayAgentHelloMessage = {
    type: "hello",
    agentVersion: config.agentVersion,
    name: config.name,
    capabilities: config.capabilities,
  };

  const pingIntervalMs = 15_000;
  let pingTimer: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    ws.send(JSON.stringify(hello));
    pingTimer = setInterval(() => {
      const ping: GatewayAgentPingMessage = { type: "ping", ts: Date.now() };
      ws.send(JSON.stringify(ping));
    }, pingIntervalMs);
  });

  ws.on("message", async (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    const message = safeJsonParse(raw);
    if (!message || typeof message !== "object") {
      return;
    }
    const type = (message as { type?: unknown }).type;
    if (type !== "execute") {
      return;
    }

    const parsed = z
      .object({
        type: z.literal("execute"),
        requestId: z.string().min(1),
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
        kind: z.enum(["connector.action", "agent.execute"]),
        payload: z.unknown(),
        secret: z.string().min(1).optional(),
      })
      .safeParse(message) as { success: boolean; data?: GatewayServerExecuteMessage };

    if (!parsed.success || !parsed.data) {
      return;
    }

    const requestId = parsed.data.requestId;
    try {
      if (parsed.data.kind === "agent.execute") {
        const payload = z
          .object({
            nodeId: z.string().min(1),
          })
          .safeParse(parsed.data.payload);

        const nodeId = payload.success ? payload.data.nodeId : "node";
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "succeeded",
            output: {
              accepted: true,
              taskId: `${nodeId}-remote-task`,
            },
          })
        );
        return;
      }

      const actionPayload = z
        .object({
          connectorId: z.string().min(1),
          actionId: z.string().min(1),
          input: z.unknown().optional(),
          env: z
            .object({
              githubApiBaseUrl: z.string().url(),
            })
            .optional(),
        })
        .safeParse(parsed.data.payload);

      if (!actionPayload.success) {
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "failed",
            error: "INVALID_ACTION_PAYLOAD",
          })
        );
        return;
      }

      const action = getCommunityConnectorAction({
        connectorId: actionPayload.data.connectorId,
        actionId: actionPayload.data.actionId,
      });
      if (!action) {
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "failed",
            error: `ACTION_NOT_SUPPORTED:${actionPayload.data.connectorId}:${actionPayload.data.actionId}`,
          })
        );
        return;
      }

      const actionInputParsed = action.inputSchema.safeParse(actionPayload.data.input);
      if (!actionInputParsed.success) {
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "failed",
            error: "INVALID_ACTION_INPUT",
          })
        );
        return;
      }

      const secret = action.requiresSecret ? parsed.data.secret ?? null : null;
      if (action.requiresSecret && !secret) {
        ws.send(
          JSON.stringify({
            type: "execute_result",
            requestId,
            status: "failed",
            error: "SECRET_REQUIRED",
          })
        );
        return;
      }

      const result = await action.execute({
        organizationId: parsed.data.organizationId,
        userId: parsed.data.userId,
        connectorId: actionPayload.data.connectorId as ConnectorId,
        actionId: actionPayload.data.actionId,
        input: actionInputParsed.data,
        secret,
        env: {
          githubApiBaseUrl: actionPayload.data.env?.githubApiBaseUrl ?? "https://api.github.com",
        },
        fetchImpl: fetch,
      });

      ws.send(
        JSON.stringify({
          type: "execute_result",
          requestId,
          status: result.status,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.status === "failed" ? { error: result.error } : {}),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "EXECUTION_FAILED";
      ws.send(JSON.stringify({ type: "execute_result", requestId, status: "failed", error: message }));
    }
  });

  ws.on("close", () => {
    if (pingTimer) {
      clearInterval(pingTimer);
    }
    process.exit(0);
  });

  ws.on("error", () => {
    if (pingTimer) {
      clearInterval(pingTimer);
    }
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    ws.once("open", () => resolve());
  });

  // Keep process alive.
  await new Promise<void>(() => {});
}

async function pairAgent(input: {
  apiBaseUrl: string;
  pairingToken: string;
  name: string;
  agentVersion: string;
}): Promise<Pick<AgentConfig, "agentId" | "agentToken" | "organizationId" | "gatewayWsUrl">> {
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

    const config: AgentConfig = {
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
    await connectGateway(config);
    return;
  }

  const configPath = parsed.configPath ?? defaultConfigPath();
  const config = await loadConfig(configPath);
  await connectGateway(config);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
