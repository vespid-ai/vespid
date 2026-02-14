import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { GatewayServerExecuteMessage } from "@vespid/shared";
import { z } from "zod";
import { executeAgentRun } from "./execute-agent-run.js";

function mockResponse(input: { ok: boolean; status: number; body: unknown }) {
  const text = JSON.stringify(input.body);
  return {
    ok: input.ok,
    status: input.status,
    async text() {
      return text;
    },
  } as any;
}

describe("node-agent agent.run", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("executes a minimal openai loop with shell.run and does not log secrets", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: any[]) => logs.push(args.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...args: any[]) => logs.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args: any[]) => logs.push(args.join(" ")));

    let llmCalls = 0;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("api.openai.com/v1/chat/completions")) {
        llmCalls += 1;
        const auth = init?.headers?.authorization ?? init?.headers?.Authorization ?? null;
        expect(auth).toBe("Bearer sk-secret");
        if (llmCalls === 1) {
          return mockResponse({
            ok: true,
            status: 200,
            body: { choices: [{ message: { content: JSON.stringify({ type: "tool_call", toolId: "shell.run", input: { script: "echo hi" } }) } }] },
          });
        }
        return mockResponse({
          ok: true,
          status: 200,
          body: { choices: [{ message: { content: JSON.stringify({ type: "final", output: { ok: true } }) } }] },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;

    const incoming: GatewayServerExecuteMessage = {
      type: "execute",
      requestId: "req-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      kind: "agent.run",
      payload: {
        nodeId: "n1",
        node: {
          id: "n1",
          type: "agent.run",
          config: {
            llm: { provider: "openai", model: "gpt-4.1-mini", auth: { fallbackToEnv: true } },
            execution: { mode: "node" },
            prompt: { instructions: "Do the thing." },
            tools: { allow: ["shell.run"], execution: "node" },
            limits: { maxTurns: 4, maxToolCalls: 4, timeoutMs: 10_000, maxOutputChars: 10_000, maxRuntimeChars: 200_000 },
            output: { mode: "text" },
          },
        },
        runId: "33333333-3333-4333-8333-333333333333",
        workflowId: "44444444-4444-4444-8444-444444444444",
        attemptCount: 1,
        env: { githubApiBaseUrl: "https://api.github.com" },
        secrets: { llmApiKey: "sk-secret" },
        organizationSettings: { tools: { shellRunEnabled: true } },
      },
    };

    // Sanity check payload shape matches the node-agent parser contract.
    const sanity = z
      .object({
        nodeId: z.string().min(1),
        node: z.unknown(),
        runId: z.string().uuid(),
        workflowId: z.string().uuid(),
        attemptCount: z.number().int().min(1).max(1000),
        env: z.object({ githubApiBaseUrl: z.string().url() }),
        secrets: z
          .object({
            llmApiKey: z.string().min(1).optional(),
            connectorSecretsByConnectorId: z.record(z.string().min(1), z.string().min(1)).optional(),
          })
          .default({}),
      })
      .safeParse(incoming.payload);
    if (!sanity.success) {
      throw new Error(`sanity payload parse failed: ${JSON.stringify(sanity.error.issues)}`);
    }

    const sandbox = {
      async executeShellTask() {
        return { status: "succeeded", output: { stdout: "hi\n" } };
      },
    } as any;

    const result = await executeAgentRun({ requestId: "req-1", incoming, sandbox });
    if (result.status === "failed") {
      throw new Error(result.error ?? "agent.run failed");
    }
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual(expect.objectContaining({ ok: true }));

    expect(logs.join("\n")).not.toContain("sk-secret");
  });
});
