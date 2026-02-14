import { z } from "zod";
import { REMOTE_EXEC_ERROR, type GatewayDispatchRequest, type GatewayDispatchResponse } from "@vespid/shared";

const dispatchResponseSchema = z.object({
  status: z.enum(["succeeded", "failed"]),
  output: z.unknown().optional(),
  error: z.string().min(1).optional(),
});

const asyncDispatchResponseSchema = z.object({
  requestId: z.string().min(1),
  dispatched: z.boolean(),
  cached: z.boolean().optional(),
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
    return { status: "failed", error: REMOTE_EXEC_ERROR.GatewayNotConfigured };
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
        return { status: "failed", error: REMOTE_EXEC_ERROR.NoAgentAvailable };
      }
      if (response.status >= 500) {
        return await pollResult({ baseUrl, serviceToken, requestId, timeoutMs: input.timeoutMs ?? 60_000 });
      }
      return { status: "failed", error: REMOTE_EXEC_ERROR.GatewayDispatchFailed };
    }

  const payload = body.length > 0 ? (JSON.parse(body) as unknown) : null;
    const parsed = dispatchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return { status: "failed", error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
    }

  return {
    status: parsed.data.status,
    ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
    ...(typeof parsed.data.error === "string" ? { error: parsed.data.error } : {}),
  };
}

export async function dispatchViaGatewayAsync(input: GatewayDispatchRequest): Promise<
  | { ok: true; requestId: string; dispatched: boolean }
  | { ok: false; error: string }
> {
  const baseUrl = getGatewayHttpUrl();
  const serviceToken = getGatewayServiceToken();
  if (!baseUrl || !serviceToken) {
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayNotConfigured };
  }

  const requestId = buildRequestId(input);
  const url = new URL("/internal/v1/dispatch-async", baseUrl);
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
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayUnavailable };
  }

  const raw = await response.text();
  if (!response.ok) {
    if (response.status === 503) {
      return { ok: false, error: REMOTE_EXEC_ERROR.NoAgentAvailable };
    }
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayDispatchFailed };
  }

  const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
  const parsed = asyncDispatchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
  }
  if (parsed.data.requestId !== requestId) {
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
  }
  return { ok: true, requestId, dispatched: parsed.data.dispatched };
}

export async function fetchGatewayResult(requestId: string): Promise<
  | { ok: true; result: GatewayDispatchResponse }
  | { ok: false; error: "RESULT_NOT_READY" | typeof REMOTE_EXEC_ERROR.GatewayUnavailable | typeof REMOTE_EXEC_ERROR.GatewayResponseInvalid }
> {
  const baseUrl = getGatewayHttpUrl();
  const serviceToken = getGatewayServiceToken();
  if (!baseUrl || !serviceToken) {
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayUnavailable };
  }

  try {
    const url = new URL(`/internal/v1/results/${encodeURIComponent(requestId)}`, baseUrl);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-gateway-token": serviceToken,
      },
    });
    if (response.status === 404) {
      return { ok: false, error: "RESULT_NOT_READY" };
    }
    if (!response.ok) {
      return { ok: false, error: REMOTE_EXEC_ERROR.GatewayUnavailable };
    }
    const payload = await response.json();
    const parsed = dispatchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
    }
    return {
      ok: true,
      result: {
        status: parsed.data.status,
        ...(parsed.data.output !== undefined ? { output: parsed.data.output } : {}),
        ...(typeof parsed.data.error === "string" ? { error: parsed.data.error } : {}),
      },
    };
  } catch {
    return { ok: false, error: REMOTE_EXEC_ERROR.GatewayUnavailable };
  }
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
          return { status: "failed", error: REMOTE_EXEC_ERROR.GatewayResponseInvalid };
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
  return { status: "failed", error: REMOTE_EXEC_ERROR.NodeExecutionTimeout };
}
