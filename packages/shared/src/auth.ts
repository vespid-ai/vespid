import crypto from "node:crypto";
import type { AccessTokenClaims, AuthSession } from "./types.js";

function b64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function b64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function hmac(content: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(content).digest("base64url");
}

export function signAuthToken(input: {
  userId: string;
  email: string;
  sessionId: string;
  ttlSec?: number;
  nowMs?: number;
  secret: string;
}): AuthSession {
  const nowMs = input.nowMs ?? Date.now();
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + (input.ttlSec ?? 60 * 60 * 8);

  const payload: AccessTokenClaims = {
    userId: input.userId,
    email: input.email,
    sessionId: input.sessionId,
    tokenType: "access",
    issuedAt,
    expiresAt,
  };

  const payloadStr = JSON.stringify(payload);
  const encoded = b64UrlEncode(payloadStr);
  const signature = hmac(encoded, input.secret);

  return {
    token: `${encoded}.${signature}`,
    userId: payload.userId,
    email: payload.email,
    sessionId: payload.sessionId,
    tokenType: payload.tokenType,
    issuedAt,
    expiresAt,
  };
}

export function verifyAuthToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): AccessTokenClaims | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = hmac(encoded, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(b64UrlDecode(encoded)) as AccessTokenClaims;
    if (!payload.userId || !payload.email || !payload.sessionId) {
      return null;
    }
    if (payload.tokenType !== "access") {
      return null;
    }
    if (payload.expiresAt <= nowSec) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
