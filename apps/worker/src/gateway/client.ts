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

export async function dispatchViaGateway(input: GatewayDispatchRequest): Promise<GatewayDispatchResponse> {
  const baseUrl = getGatewayHttpUrl();
  const serviceToken = getGatewayServiceToken();
  if (!baseUrl || !serviceToken) {
    return { status: "failed", error: "GATEWAY_NOT_CONFIGURED" };
  }

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
    return { status: "failed", error: "GATEWAY_UNAVAILABLE" };
  }

  const body = await response.text();
  if (!response.ok) {
    if (response.status === 503) {
      return { status: "failed", error: "NO_AGENT_AVAILABLE" };
    }
    return { status: "failed", error: `GATEWAY_DISPATCH_FAILED:${response.status}` };
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
