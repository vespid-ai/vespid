import Fastify from "fastify";
import { z } from "zod";
import { runLlmInference, type LlmInvokeInput } from "@vespid/agent-runtime";

function parseBearerToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

const inferSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini", "vertex"]),
  model: z.string().min(1).max(200),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })
  ),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000),
  maxOutputChars: z.number().int().min(128).max(2_000_000).optional(),
  auth: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("api_key"),
      apiKey: z.string().min(1),
    }),
    z.object({
      kind: z.literal("vertex_oauth"),
      refreshToken: z.string().min(1),
      projectId: z.string().min(1),
      location: z.string().min(1),
    }),
  ]),
});

export async function buildEngineRunnerServer(input?: { token?: string }) {
  const server = Fastify({
    disableRequestLogging: true,
    forceCloseConnections: true,
    logger: {
      level: process.env.ENGINE_RUNNER_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      redact: {
        paths: [
          "req.headers.authorization",
          "auth.apiKey",
          "auth.refreshToken",
          "auth",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  const configuredToken = (input?.token ?? process.env.ENGINE_RUNNER_TOKEN ?? "").trim();
  const token = configuredToken.length > 0
    ? configuredToken
    : (process.env.NODE_ENV === "production" ? "" : "dev-engine-runner-token");
  if (token.length === 0) {
    throw new Error("ENGINE_RUNNER_TOKEN_REQUIRED");
  }
  if (configuredToken.length === 0) {
    server.log.warn("ENGINE_RUNNER_TOKEN is empty; using development fallback token.");
  }

  server.get("/healthz", async () => ({ ok: true }));

  server.post("/internal/v1/llm/infer", async (request: any, reply: any) => {
    const bearer = parseBearerToken(request.headers.authorization);
    if (!bearer || bearer !== token) {
      return reply.status(401).send({ ok: false, error: "UNAUTHORIZED" });
    }

    const parsed = inferSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "BAD_REQUEST" });
    }

    try {
      const result = await runLlmInference(parsed.data as LlmInvokeInput);
      return reply.status(200).send(result);
    } catch {
      return reply.status(503).send({ ok: false, error: "ENGINE_UNAVAILABLE" });
    }
  });

  return server;
}
