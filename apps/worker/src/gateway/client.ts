import { z } from "zod";
import type { GatewayDispatchRequest, GatewayDispatchResponse } from "@vespid/shared";

const dispatchResponseSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  output: z.unknown().optional(),
  error: z.string().min(1).optional(),
});

export function getGatewayHttpUrl(): string | null {
  const raw = process.env.GATEWAY_HTTP_URL;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw;
}

export function getGatewayServiceToken(): string | null {
  const raw = process.env.GATEWAY_SERVICE_TOKEN;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw;
}

function buildRequestId(input: GatewayDispatchRequest): string {
  return `${input.runId}:${input.nodeId}:${input.attemptCount}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchViaGateway(input: GatewayDispatchRequest): Promise<GatewayDispatchResponse> {
  const baseUrl = getGatewayHttpUrl();
  const serviceToken = getGatewayServiceToken();
  if (!baseUrl || !serviceToken) {
    return { status: "failed", error: "GATEWAY_NOT_CONFIGURED" };
  }

  const requestId = buildRequestId(input);
  const url = new URL("/internal/v1/dispatch", baseUrl);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": serviceToken,
      },
      body: JSON.stringify(input),
    });
  } catch {
    // If the gateway is restarting, the agent may still complete. Poll for a cached result.
    return await pollResult({ baseUrl, serviceToken, requestId, timeoutMs: input.timeoutMs ?? 60_000 });
  }

  const body = await response.text();
  if (!response.ok) {
    if (response.status === 503) {
      return { status: "failed", error: "NO_AGENT_AVAILABLE" };
    }
    if (response.status >= 500) {
      return await pollResult({ baseUrl, serviceToken, requestId, timeoutMs: input.timeoutMs ?? 60_000 });
    }
    return { status: "failed", error: "GATEWAY_DISPATCH_FAILED" };
  }

  const payload = body.length > 0 ? (JSON.parse(body) as unknown) : null;
  const parsed = dispatchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "failed", error: "GATEWAY_RESPONSE_INVALID" };
  }

  return {
    status: parsed.data.status,
    ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
    ...(typeof parsed.data.error === "string" ? { error: parsed.data.error } : {}),
  };
}

async function pollResult(input: {
  baseUrl: string;
  serviceToken: string;
  requestId: string;
  timeoutMs: number;
}): Promise<GatewayDispatchResponse> {
  const start = Date.now();
  let delay = 250;
  while (Date.now() - start < input.timeoutMs) {
    try {
      const url = new URL(`/internal/v1/results/${encodeURIComponent(input.requestId)}`, input.baseUrl);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-gateway-token": input.serviceToken,
        },
      });
      if (response.status === 404) {
        // Not ready yet.
      } else if (!response.ok) {
        // Retry on transient gateway issues.
      } else {
        const payload = await response.json();
        const parsed = dispatchResponseSchema.safeParse(payload);
        if (!parsed.success) {
          return { status: "failed", error: "GATEWAY_RESPONSE_INVALID" };
        }
        return {
          status: parsed.data.status,
          ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
          ...(typeof parsed.data.error === "string" ? { error: parsed.data.error } : {}),
        };
      }
    } catch {
      // retry
    }
    await sleep(delay);
    delay = Math.min(2000, Math.floor(delay * 1.6));
  }
  return { status: "failed", error: "NODE_EXECUTION_TIMEOUT" };
}
