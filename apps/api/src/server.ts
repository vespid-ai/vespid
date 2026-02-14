import crypto from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  signAuthToken,
  unauthorized,
  verifyAuthToken,
  type EnterpriseProvider,
  loadEnterpriseProvider,
  resolveEditionCapabilities,
  resolveEnterpriseConnectors,
  type AppError as AppErrorType,
} from "@vespid/shared";
import { createConnectorCatalog } from "@vespid/connectors";
import { generateCodeVerifier, generateState } from "arctic";
import { z } from "zod";
import { createOAuthServiceFromEnv, type OAuthProvider, type OAuthService } from "./oauth.js";
import { createStore } from "./store/index.js";
import type { AppStore, MembershipRecord, SessionRecord, UserRecord } from "./types.js";
import { hashPassword, verifyPassword } from "./security.js";
import { workflowDslSchema } from "@vespid/workflow";
import {
  createBullMqWorkflowRunQueueProducer,
  createInMemoryWorkflowRunQueueProducer,
  type WorkflowRunQueueProducer,
} from "./queue/producer.js";

type AuthContext = {
  userId: string;
  email: string;
  sessionId: string;
};

type OrgContext = {
  organizationId: string;
  membership: MembershipRecord;
};

type OrgContextEnforcement = "strict" | "warn";

type OAuthStateRecord = {
  provider: OAuthProvider;
  codeVerifier: string;
  nonce: string;
  expiresAtSec: number;
};

type RefreshTokenPayload = {
  sessionId: string;
  userId: string;
  tokenNonce: string;
  expiresAt: number;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    orgContext?: OrgContext;
    orgContextWarnings?: string[];
  }
}

const ACCESS_TOKEN_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 15 * 60);
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC ?? 7 * 24 * 60 * 60);
const OAUTH_CONTEXT_TTL_SEC = Number(process.env.OAUTH_CONTEXT_TTL_SEC ?? 10 * 60);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "vespid_session";
const OAUTH_STATE_COOKIE_NAME = "vespid_oauth_state";
const OAUTH_NONCE_COOKIE_NAME = "vespid_oauth_nonce";
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const API_LOG_LEVEL = process.env.API_LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
const ORG_CONTEXT_ENFORCEMENT = z
  .enum(["strict", "warn"])
  .default("strict")
  .parse(process.env.ORG_CONTEXT_ENFORCEMENT ?? "strict");

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,50}$/),
});

const inviteSchema = z.object({
  email: z.string().email(),
  roleKey: z.enum(["admin", "member"]),
});

const roleMutationSchema = z.object({
  roleKey: z.enum(["owner", "admin", "member"]),
});

const createWorkflowSchema = z.object({
  name: z.string().min(2).max(120),
  dsl: workflowDslSchema,
});

const createWorkflowRunSchema = z.object({
  input: z.unknown().optional(),
});

const listSecretsQuerySchema = z.object({
  connectorId: z.string().min(1).optional(),
});

const createSecretSchema = z.object({
  connectorId: z.enum(["github"]),
  name: z.string().min(1).max(80),
  value: z.string().min(1),
});

const rotateSecretSchema = z.object({
  value: z.string().min(1),
});

const agentPairSchema = z.object({
  pairingToken: z.string().min(1),
  name: z.string().min(1).max(120),
  agentVersion: z.string().min(1).max(60),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

const listWorkflowRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

const listWorkflowRunEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).optional(),
});

const oauthQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  mode: z.enum(["json"]).optional(),
});

function toPublicUser(input: { id: string; email: string; displayName: string | null; createdAt: string }) {
  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    createdAt: input.createdAt,
  };
}

function parseAuthHeader(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function orgContextRequired(message = "X-Org-Id header is required"): AppError {
  return new AppError(400, { code: "ORG_CONTEXT_REQUIRED", message });
}

function orgContextInvalid(message = "Invalid organization context"): AppError {
  return new AppError(400, { code: "INVALID_ORG_CONTEXT", message });
}

function orgAccessDenied(message = "You are not a member of this organization"): AppError {
  return new AppError(403, { code: "ORG_ACCESS_DENIED", message });
}

function queueUnavailable(message = "Workflow queue is unavailable"): AppError {
  return new AppError(503, { code: "QUEUE_UNAVAILABLE", message });
}

function secretsNotConfigured(): AppError {
  return new AppError(503, { code: "SECRETS_NOT_CONFIGURED", message: "Secrets KEK is not configured" });
}

function secretNotFound(): AppError {
  return new AppError(404, { code: "SECRET_NOT_FOUND", message: "Secret not found" });
}

function secretAlreadyExists(): AppError {
  return new AppError(409, { code: "SECRET_ALREADY_EXISTS", message: "Secret already exists" });
}

function secretValueRequired(): AppError {
  return new AppError(400, { code: "SECRET_VALUE_REQUIRED", message: "Secret value is required" });
}

function pairingTokenInvalid(message = "Pairing token is invalid"): AppError {
  return new AppError(401, { code: "PAIRING_TOKEN_INVALID", message });
}

function pairingTokenExpired(message = "Pairing token is expired"): AppError {
  return new AppError(400, { code: "PAIRING_TOKEN_EXPIRED", message });
}

function agentNotFound(message = "Agent not found"): AppError {
  return new AppError(404, { code: "AGENT_NOT_FOUND", message });
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function encodeCursor(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

function decodeCursor<T>(value: string): T | null {
  try {
    return JSON.parse(base64UrlDecode(value)) as T;
  } catch {
    return null;
  }
}

function hmac(content: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(content).digest("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function signRefreshToken(payload: RefreshTokenPayload, secret: string): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifyRefreshToken(token: string, secret: string): RefreshTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = hmac(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<RefreshTokenPayload>;
    if (!payload.sessionId || !payload.userId || !payload.tokenNonce || typeof payload.expiresAt !== "number") {
      return null;
    }
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      tokenNonce: payload.tokenNonce,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

function isSessionActive(session: SessionRecord): boolean {
  if (session.revokedAt) {
    return false;
  }
  return new Date(session.expiresAt).getTime() > Date.now();
}

function extractProvider(value: unknown): OAuthProvider {
  const parsed = z.enum(["google", "github"]).safeParse(value);
  if (!parsed.success) {
    throw badRequest("Unsupported OAuth provider");
  }
  return parsed.data;
}

function parseInvitationTokenOrganizationId(token: string): string | null {
  const [organizationId] = token.split(".");
  const parsed = z.string().uuid().safeParse(organizationId);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function parsePairingTokenOrganizationId(token: string): string | null {
  const [organizationId] = token.split(".");
  const parsed = z.string().uuid().safeParse(organizationId);
  return parsed.success ? parsed.data : null;
}

function parseOrgHeaderValue(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0) {
    throw orgContextRequired();
  }
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) {
    throw orgContextInvalid("X-Org-Id must be a valid UUID");
  }
  return parsed.data;
}

function parseUserAgent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function toOAuthAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "OAUTH_EXCHANGE_FAILED";

  if (message.startsWith("OAUTH_PROVIDER_NOT_CONFIGURED:")) {
    const provider = message.split(":")[1] ?? "provider";
    return new AppError(503, {
      code: "OAUTH_PROVIDER_NOT_CONFIGURED",
      message: `OAuth provider is not configured: ${provider}`,
    });
  }

  if (message === "OAUTH_INVALID_NONCE") {
    return new AppError(401, {
      code: "OAUTH_INVALID_NONCE",
      message: "Invalid OAuth nonce",
    });
  }

  if (message === "OAUTH_EMAIL_REQUIRED") {
    return new AppError(400, {
      code: "OAUTH_EMAIL_REQUIRED",
      message: "OAuth provider did not return an email address",
    });
  }

  return new AppError(401, {
    code: message.startsWith("OAUTH_") ? message : "OAUTH_EXCHANGE_FAILED",
    message: "OAuth exchange failed",
  });
}

function invitationErrorToAppError(error: Error): AppError {
  if (error.message === "INVITATION_NOT_FOUND") {
    return notFound("Invitation not found");
  }
  if (error.message === "INVITATION_EXPIRED") {
    return badRequest("Invitation has expired");
  }
  if (error.message === "INVITATION_EMAIL_MISMATCH") {
    return forbidden("Invitation email does not match authenticated user");
  }
  if (error.message === "INVITATION_NOT_PENDING") {
    return badRequest("Invitation is not pending");
  }
  return new AppError(500, {
    code: "INVITATION_ACCEPT_FAILED",
    message: "Invitation accept failed",
  });
}

export async function buildServer(input?: {
  store?: AppStore;
  oauthService?: OAuthService;
  orgContextEnforcement?: OrgContextEnforcement;
  queueProducer?: WorkflowRunQueueProducer;
  enterpriseProvider?: EnterpriseProvider;
}) {
  const server = Fastify({
    logger: {
      level: API_LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[REDACTED]",
      },
    },
  });

  await server.register(cookie);
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === WEB_BASE_URL) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  const store = input?.store ?? createStore();
  const oauthService = input?.oauthService ?? createOAuthServiceFromEnv();
  const orgContextEnforcement: OrgContextEnforcement = input?.orgContextEnforcement ?? ORG_CONTEXT_ENFORCEMENT;
  const queueProducer =
    input?.queueProducer ??
    (process.env.NODE_ENV === "test" && !process.env.REDIS_URL
      ? createInMemoryWorkflowRunQueueProducer()
      : createBullMqWorkflowRunQueueProducer());
  const enterpriseProvider = await loadEnterpriseProvider({
    ...(input?.enterpriseProvider ? { inlineProvider: input.enterpriseProvider } : {}),
    logger: server.log,
  });
  const editionCapabilities = resolveEditionCapabilities(enterpriseProvider);
  const connectorCatalog = createConnectorCatalog({
    enterpriseConnectors: resolveEnterpriseConnectors(enterpriseProvider),
  });
  await store.ensureDefaultRoles();

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? "dev-auth-secret";
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET ?? authSecret;
  const oauthStateSecret = process.env.OAUTH_STATE_SECRET ?? "dev-oauth-state-secret";
  const secureCookies = process.env.NODE_ENV === "production";
  const oauthStates = new Map<string, OAuthStateRecord>();

  function setSessionCookie(reply: { setCookie: Function }, refreshToken: string): void {
    reply.setCookie(SESSION_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      path: "/",
      maxAge: SESSION_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function clearSessionCookie(reply: { clearCookie: Function }): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function setOAuthCookies(reply: { setCookie: Function }, input: { state: string; nonce: string }): void {
    reply.setCookie(OAUTH_STATE_COOKIE_NAME, signRefreshToken(
      {
        sessionId: input.state,
        userId: "oauth",
        tokenNonce: "state",
        expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
      },
      oauthStateSecret
    ), {
      httpOnly: true,
      path: "/",
      maxAge: OAUTH_CONTEXT_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });

    reply.setCookie(OAUTH_NONCE_COOKIE_NAME, signRefreshToken(
      {
        sessionId: input.nonce,
        userId: "oauth",
        tokenNonce: "nonce",
        expiresAt: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
      },
      oauthStateSecret
    ), {
      httpOnly: true,
      path: "/",
      maxAge: OAUTH_CONTEXT_TTL_SEC,
      sameSite: "lax",
      secure: secureCookies,
    });
  }

  function clearOAuthCookies(reply: { clearCookie: Function }): void {
    reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
    reply.clearCookie(OAUTH_NONCE_COOKIE_NAME, { path: "/", sameSite: "lax", secure: secureCookies });
  }

  async function createSessionForUser(input: {
    user: UserRecord;
    userAgent: string | undefined;
    ip: string | undefined;
    reply: { setCookie: Function };
  }) {
    const sessionId = crypto.randomUUID();
    const refreshPayload: RefreshTokenPayload = {
      sessionId,
      userId: input.user.id,
      tokenNonce: crypto.randomBytes(24).toString("base64url"),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
    };
    const refreshToken = signRefreshToken(refreshPayload, refreshSecret);

    await store.createSession({
      id: sessionId,
      userId: input.user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(refreshPayload.expiresAt * 1000),
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    });

    const session = signAuthToken({
      userId: input.user.id,
      email: input.user.email,
      sessionId,
      ttlSec: ACCESS_TOKEN_TTL_SEC,
      secret: authSecret,
    });

    setSessionCookie(input.reply, refreshToken);
    return session;
  }

  async function authenticateFromBearerToken(token: string): Promise<AuthContext | null> {
    const payload = verifyAuthToken(token, authSecret);
    if (!payload) {
      return null;
    }

    const [session, user] = await Promise.all([
      store.getSessionById({ userId: payload.userId, sessionId: payload.sessionId }),
      store.getUserById(payload.userId),
    ]);

    if (!session || !user || !isSessionActive(session)) {
      return null;
    }

    await store.touchSession({ userId: payload.userId, sessionId: payload.sessionId });

    return {
      userId: payload.userId,
      email: payload.email,
      sessionId: payload.sessionId,
    };
  }

  async function authenticateFromRefreshCookie(input: {
    token: string;
    rotateRefreshToken: boolean;
    reply: { setCookie: Function };
  }): Promise<{ auth: AuthContext; session: ReturnType<typeof signAuthToken>; user: UserRecord } | null> {
    const payload = verifyRefreshToken(input.token, refreshSecret);
    if (!payload) {
      return null;
    }

    const [session, user] = await Promise.all([
      store.getSessionById({ userId: payload.userId, sessionId: payload.sessionId }),
      store.getUserById(payload.userId),
    ]);

    if (!session || !user || !isSessionActive(session)) {
      return null;
    }

    if (!timingSafeEqual(session.refreshTokenHash, hashRefreshToken(input.token))) {
      return null;
    }

    if (input.rotateRefreshToken) {
      const rotatedPayload: RefreshTokenPayload = {
        sessionId: payload.sessionId,
        userId: payload.userId,
        tokenNonce: crypto.randomBytes(24).toString("base64url"),
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
      };
      const rotatedToken = signRefreshToken(rotatedPayload, refreshSecret);
      await store.rotateSessionRefreshToken({
        userId: payload.userId,
        sessionId: payload.sessionId,
        refreshTokenHash: hashRefreshToken(rotatedToken),
        expiresAt: new Date(rotatedPayload.expiresAt * 1000),
      });
      setSessionCookie(input.reply, rotatedToken);
    } else {
      await store.touchSession({ userId: payload.userId, sessionId: payload.sessionId });
    }

    const accessSession = signAuthToken({
      userId: user.id,
      email: user.email,
      sessionId: payload.sessionId,
      ttlSec: ACCESS_TOKEN_TTL_SEC,
      secret: authSecret,
    });

    return {
      auth: {
        userId: user.id,
        email: user.email,
        sessionId: payload.sessionId,
      },
      session: accessSession,
      user,
    };
  }

  async function requireOrgContext(request: {
    headers: Record<string, unknown>;
    id: string;
    method: string;
    url: string;
    auth?: AuthContext;
    orgContext?: OrgContext;
    orgContextWarnings?: string[];
  }, input?: { expectedOrgId?: string }): Promise<OrgContext> {
    if (request.orgContext) {
      return request.orgContext;
    }

    const auth = request.auth;
    if (!auth) {
      throw unauthorized();
    }
    const authContext = auth;

    function warnOrgContext(code: "ORG_CONTEXT_REQUIRED" | "INVALID_ORG_CONTEXT", message: string) {
      request.orgContextWarnings ??= [];
      request.orgContextWarnings.push(code);
      server.log.warn(
        {
          event: "org_context_header_fallback",
          reason: code,
          userId: authContext.userId,
          routeOrgId: input?.expectedOrgId ?? null,
          headerOrgId: request.headers["x-org-id"],
          requestId: request.id,
          path: request.url,
          method: request.method,
          message,
        },
        "org context header fallback"
      );
    }

    let orgId: string;
    try {
      orgId = parseOrgHeaderValue(request.headers["x-org-id"]);
    } catch (error) {
      if (orgContextEnforcement === "strict") {
        throw error;
      }
      if (!input?.expectedOrgId) {
        throw error;
      }
      orgId = input.expectedOrgId;
      warnOrgContext("ORG_CONTEXT_REQUIRED", "Missing/invalid X-Org-Id header; fell back to route org id");
    }

    if (input?.expectedOrgId && input.expectedOrgId !== orgId) {
      if (orgContextEnforcement === "strict") {
        throw orgContextInvalid("X-Org-Id does not match route organization id");
      }
      warnOrgContext("INVALID_ORG_CONTEXT", "X-Org-Id mismatched route org id; fell back to route org id");
      orgId = input.expectedOrgId;
    }

    const membership = await store.getMembership({
      organizationId: orgId,
      userId: authContext.userId,
      actorUserId: authContext.userId,
    });

    if (!membership) {
      server.log.warn(
        {
          event: "org_context_access_denied",
          userId: authContext.userId,
          orgId,
          requestId: request.id,
          path: request.url,
          method: request.method,
        },
        "org context access denied"
      );
      throw orgAccessDenied();
    }

    const context: OrgContext = { organizationId: orgId, membership };
    request.orgContext = context;
    return context;
  }

  function requireAuth(request: { auth?: AuthContext }): AuthContext {
    if (!request.auth) {
      throw unauthorized();
    }
    return request.auth;
  }

  server.setErrorHandler((error, _request, reply) => {
    const appError = error as Partial<AppErrorType> & { payload?: unknown };
    const errorCode = (error as { code?: unknown }).code;
    if (typeof appError.statusCode === "number" && appError.payload) {
      return reply.status(appError.statusCode).send(appError.payload);
    }
    if (typeof appError.statusCode === "number" && appError.statusCode >= 400 && appError.statusCode < 500) {
      return reply.status(appError.statusCode).send({
        code: typeof errorCode === "string" ? errorCode : "REQUEST_ERROR",
        message: typeof appError.message === "string" ? appError.message : "Request error",
      });
    }
    server.log.error({ err: error }, "unhandled application error");
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });

  server.addHook("preHandler", async (request, reply) => {
    const bearer = parseAuthHeader(request.headers.authorization);
    if (bearer) {
      const auth = await authenticateFromBearerToken(bearer);
      if (auth) {
        request.auth = auth;
        return;
      }
    }

    const refreshCookie = request.cookies[SESSION_COOKIE_NAME];
    if (!refreshCookie) {
      return;
    }

    const authResult = await authenticateFromRefreshCookie({
      token: refreshCookie,
      rotateRefreshToken: false,
      reply,
    });
    if (!authResult) {
      return;
    }

    request.auth = authResult.auth;
    reply.header("x-access-token", authResult.session.token);
  });

  server.addHook("onSend", async (request, reply, payload) => {
    if (request.orgContextWarnings && request.orgContextWarnings.length > 0) {
      const uniqueWarnings = [...new Set(request.orgContextWarnings)];
      reply.header("x-org-context-warning", uniqueWarnings.join(","));
    }
    return payload;
  });

  server.addHook("onClose", async () => {
    await queueProducer.close();
  });

  server.post("/v1/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid signup payload", parsed.error.flatten());
    }

    const existing = await store.getUserByEmail(parsed.data.email);
    if (existing) {
      throw conflict("Email already registered");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await store.createUser({
      email: parsed.data.email,
      passwordHash,
      displayName: parsed.data.displayName ?? null,
    });

    const session = await createSessionForUser({
      user,
      userAgent: parseUserAgent(request.headers["user-agent"]),
      ip: request.ip,
      reply,
    });

    return reply.status(201).send({ session, user: toPublicUser(user) });
  });

  server.post("/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid login payload", parsed.error.flatten());
    }

    const user = await store.getUserByEmail(parsed.data.email);
    if (!user) {
      throw unauthorized("Invalid credentials");
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      throw unauthorized("Invalid credentials");
    }

    const session = await createSessionForUser({
      user,
      userAgent: parseUserAgent(request.headers["user-agent"]),
      ip: request.ip,
      reply,
    });

    return { session, user: toPublicUser(user) };
  });

  server.post("/v1/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies[SESSION_COOKIE_NAME];
    if (!refreshToken) {
      throw unauthorized("Session cookie is required");
    }

    const authResult = await authenticateFromRefreshCookie({
      token: refreshToken,
      rotateRefreshToken: true,
      reply,
    });

    if (!authResult) {
      throw unauthorized("Refresh token is invalid or expired");
    }

    return {
      session: authResult.session,
      user: toPublicUser(authResult.user),
    };
  });

  server.post("/v1/auth/logout", async (request, reply) => {
    const auth = requireAuth(request);
    await store.revokeSession({ userId: auth.userId, sessionId: auth.sessionId });
    clearSessionCookie(reply);
    return { ok: true };
  });

  server.post("/v1/auth/logout-all", async (request, reply) => {
    const auth = requireAuth(request);
    const revokedCount = await store.revokeAllSessionsForUser(auth.userId);
    clearSessionCookie(reply);
    return { ok: true, revokedCount };
  });

  server.get("/v1/auth/oauth/:provider/start", async (request, reply) => {
    const provider = extractProvider((request.params as { provider?: string }).provider);
    const mode = (request.query as { mode?: string }).mode;

    const state = generateState();
    const nonce = crypto.randomBytes(24).toString("base64url");
    const codeVerifier = generateCodeVerifier();

    oauthStates.set(state, {
      provider,
      codeVerifier,
      nonce,
      expiresAtSec: Math.floor(Date.now() / 1000) + OAUTH_CONTEXT_TTL_SEC,
    });

    let authorizationUrl: URL;
    try {
      authorizationUrl = oauthService.createAuthorizationUrl(provider, {
        state,
        codeVerifier,
        nonce,
      });
    } catch (error) {
      throw toOAuthAppError(error);
    }

    setOAuthCookies(reply, { state, nonce });

    if (mode === "json") {
      return {
        provider,
        authorizationUrl: authorizationUrl.toString(),
      };
    }

    return reply.redirect(authorizationUrl.toString());
  });

  server.get("/v1/meta/capabilities", async () => {
    return {
      edition: enterpriseProvider.edition,
      capabilities: editionCapabilities,
      provider: {
        name: enterpriseProvider.name,
        version: enterpriseProvider.version ?? null,
      },
    };
  });

  server.get("/v1/meta/connectors", async () => {
    return {
      connectors: connectorCatalog,
    };
  });

  server.get("/v1/auth/oauth/:provider/callback", async (request, reply) => {
    const provider = extractProvider((request.params as { provider?: string }).provider);
    const parsed = oauthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw badRequest("Invalid OAuth callback query", parsed.error.flatten());
    }

    try {
      const signedStateCookie = request.cookies[OAUTH_STATE_COOKIE_NAME];
      const signedNonceCookie = request.cookies[OAUTH_NONCE_COOKIE_NAME];
      if (!signedStateCookie || !signedNonceCookie) {
        throw unauthorized("Missing OAuth state/nonce cookies");
      }

      const stateCookiePayload = verifyRefreshToken(signedStateCookie, oauthStateSecret);
      const nonceCookiePayload = verifyRefreshToken(signedNonceCookie, oauthStateSecret);
      if (!stateCookiePayload || !nonceCookiePayload) {
        throw unauthorized("Invalid OAuth state/nonce cookies");
      }

      if (stateCookiePayload.sessionId !== parsed.data.state) {
        throw unauthorized("Invalid OAuth state");
      }

      const stored = oauthStates.get(parsed.data.state);
      oauthStates.delete(parsed.data.state);
      clearOAuthCookies(reply);

      if (!stored || stored.provider !== provider || stored.expiresAtSec <= Math.floor(Date.now() / 1000)) {
        throw unauthorized("Invalid or expired OAuth state");
      }

      if (nonceCookiePayload.sessionId !== stored.nonce) {
        throw unauthorized("Invalid OAuth nonce");
      }

      const profile = await oauthService.exchangeCodeForProfile(provider, {
        code: parsed.data.code,
        codeVerifier: stored.codeVerifier,
        nonce: stored.nonce,
      });

      const existingUser = await store.getUserByEmail(profile.email);
      const user =
        existingUser ??
        (await store.createUser({
          email: profile.email,
          passwordHash: await hashPassword(`oauth:${provider}:${crypto.randomUUID()}`),
          displayName: profile.displayName,
        }));

      const session = await createSessionForUser({
        user,
        userAgent: parseUserAgent(request.headers["user-agent"]),
        ip: request.ip,
        reply,
      });

      if (parsed.data.mode === "json") {
        return {
          session,
          user: toPublicUser(user),
          provider,
        };
      }

      const redirectUrl = new URL("/auth", WEB_BASE_URL);
      redirectUrl.searchParams.set("oauth", "success");
      redirectUrl.searchParams.set("provider", provider);
      return reply.redirect(redirectUrl.toString());
    } catch (error) {
      const mapped = toOAuthAppError(error);
      server.log.warn(
        {
          event: "oauth_callback_failed",
          provider,
          reasonCode: mapped.payload.code,
          requestId: request.id,
          path: request.url,
        },
        "oauth callback failed"
      );

      if (parsed.data.mode === "json") {
        throw mapped;
      }
      const redirectUrl = new URL("/auth", WEB_BASE_URL);
      redirectUrl.searchParams.set("oauth", "error");
      redirectUrl.searchParams.set("provider", provider);
      redirectUrl.searchParams.set("code", mapped.payload.code);
      return reply.redirect(redirectUrl.toString());
    }
  });

  server.post("/v1/orgs", async (request, reply) => {
    const auth = requireAuth(request);
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid organization payload", parsed.error.flatten());
    }

    const created = await store.createOrganizationWithOwner({
      name: parsed.data.name,
      slug: parsed.data.slug,
      ownerUserId: auth.userId,
    });

    return reply.status(201).send(created);
  });

  server.post("/v1/orgs/:orgId/invitations", async (request, reply) => {
    const auth = requireAuth(request);
    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to invite members");
    }

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid invitation payload", parsed.error.flatten());
    }

    const invitation = await store.createInvitation({
      organizationId: orgContext.organizationId,
      email: parsed.data.email,
      roleKey: parsed.data.roleKey,
      invitedByUserId: auth.userId,
    });

    return reply.status(201).send({ invitation });
  });

  server.post("/v1/orgs/:orgId/members/:memberId/role", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; memberId?: string };
    if (!params.orgId || !params.memberId) {
      throw badRequest("Missing orgId or memberId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to change membership roles");
    }

    const parsed = roleMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid role update payload", parsed.error.flatten());
    }

    if (parsed.data.roleKey === "owner" && orgContext.membership.roleKey !== "owner") {
      throw forbidden("Only owner can assign owner role");
    }

    const updated = await store.updateMembershipRole({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      memberUserId: params.memberId,
      roleKey: parsed.data.roleKey,
    });

    if (!updated) {
      throw notFound("Membership not found");
    }

    return { membership: updated };
  });

  server.get("/v1/orgs/:orgId/secrets", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const parsed = listSecretsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list secrets query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const secrets = await store.listConnectorSecrets({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      connectorId: parsed.data.connectorId ?? null,
    });

    return { secrets };
  });

  server.post("/v1/orgs/:orgId/secrets", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const parsed = createSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid secret payload", parsed.error.flatten());
    }
    if (parsed.data.value.trim().length === 0) {
      throw secretValueRequired();
    }

    try {
      const secret = await store.createConnectorSecret({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        connectorId: parsed.data.connectorId,
        name: parsed.data.name,
        value: parsed.data.value,
      });
      return reply.status(201).send({ secret });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "SECRET_ALREADY_EXISTS") {
          throw secretAlreadyExists();
        }
        if (error.message === "SECRETS_KEK_BASE64_REQUIRED" || error.message === "SECRETS_KEK_BASE64_INVALID") {
          throw secretsNotConfigured();
        }
      }
      throw error;
    }
  });

  server.put("/v1/orgs/:orgId/secrets/:secretId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; secretId?: string };
    if (!params.orgId || !params.secretId) {
      throw badRequest("Missing orgId or secretId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const parsed = rotateSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid secret payload", parsed.error.flatten());
    }
    if (parsed.data.value.trim().length === 0) {
      throw secretValueRequired();
    }

    try {
      const secret = await store.rotateConnectorSecret({
        organizationId: orgContext.organizationId,
        actorUserId: auth.userId,
        secretId: params.secretId,
        value: parsed.data.value,
      });
      if (!secret) {
        throw secretNotFound();
      }
      return { secret };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "SECRETS_KEK_BASE64_REQUIRED" || error.message === "SECRETS_KEK_BASE64_INVALID") {
          throw secretsNotConfigured();
        }
      }
      throw error;
    }
  });

  server.delete("/v1/orgs/:orgId/secrets/:secretId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; secretId?: string };
    if (!params.orgId || !params.secretId) {
      throw badRequest("Missing orgId or secretId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage secrets");
    }

    const ok = await store.deleteConnectorSecret({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      secretId: params.secretId,
    });

    if (!ok) {
      throw secretNotFound();
    }

    return { ok: true };
  });

  server.get("/v1/orgs/:orgId/agents", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage agents");
    }

    const agents = await store.listOrganizationAgents({ organizationId: orgContext.organizationId, actorUserId: auth.userId });
    const nowMs = Date.now();
    const staleMsRaw = Number(process.env.GATEWAY_AGENT_STALE_MS ?? 60_000);
    const staleMs = Number.isFinite(staleMsRaw) ? staleMsRaw : 60_000;
    const onlineWindowMs = Math.min(5 * 60_000, Math.max(30_000, staleMs));

    return {
      agents: agents.map((agent) => {
        const lastSeenMs = agent.lastSeenAt ? new Date(agent.lastSeenAt).getTime() : null;
        const online = Boolean(lastSeenMs && nowMs - lastSeenMs < onlineWindowMs);
        const status = agent.revokedAt ? "revoked" : online ? "online" : "offline";
        return {
          id: agent.id,
          name: agent.name,
          status,
          lastSeenAt: agent.lastSeenAt,
          createdAt: agent.createdAt,
          revokedAt: agent.revokedAt,
        };
      }),
    };
  });

  server.post("/v1/orgs/:orgId/agents/pairing-tokens", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string };
    if (!params.orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage agents");
    }

    const token = `${orgContext.organizationId}.${crypto.randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await store.createAgentPairingToken({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      tokenHash: sha256Hex(token),
      expiresAt,
    });

    return reply.status(201).send({ token, expiresAt: expiresAt.toISOString() });
  });

  server.post("/v1/orgs/:orgId/agents/:agentId/revoke", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; agentId?: string };
    if (!params.orgId || !params.agentId) {
      throw badRequest("Missing orgId or agentId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to manage agents");
    }

    const ok = await store.revokeOrganizationAgent({
      organizationId: orgContext.organizationId,
      actorUserId: auth.userId,
      agentId: params.agentId,
    });

    if (!ok) {
      throw agentNotFound();
    }

    return { ok: true };
  });

  server.post("/v1/agents/pair", async (request, reply) => {
    const parsed = agentPairSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid agent pairing payload", parsed.error.flatten());
    }

    const orgId = parsePairingTokenOrganizationId(parsed.data.pairingToken);
    if (!orgId) {
      throw pairingTokenInvalid("Pairing token is malformed");
    }

    const tokenHash = sha256Hex(parsed.data.pairingToken);
    const existing = await store.getAgentPairingTokenByHash({ organizationId: orgId, tokenHash });
    if (!existing) {
      throw pairingTokenInvalid();
    }
    if (existing.usedAt) {
      throw pairingTokenInvalid("Pairing token has already been used");
    }
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      throw pairingTokenExpired();
    }

    const consumed = await store.consumeAgentPairingToken({ organizationId: orgId, tokenHash });
    if (!consumed) {
      throw pairingTokenInvalid();
    }

    const agentToken = `${orgId}.${crypto.randomBytes(32).toString("base64url")}`;
    const agent = await store.createOrganizationAgent({
      organizationId: orgId,
      name: parsed.data.name,
      tokenHash: sha256Hex(agentToken),
      createdByUserId: existing.createdByUserId,
      capabilities: parsed.data.capabilities ?? null,
    });

    const gatewayWsUrl = process.env.GATEWAY_WS_URL ?? "ws://localhost:3002/ws";

    return reply.status(201).send({
      agentId: agent.id,
      agentToken,
      organizationId: orgId,
      gatewayWsUrl,
    });
  });

  server.post("/v1/orgs/:orgId/workflows", async (request, reply) => {
    const auth = requireAuth(request);
    const orgId = (request.params as { orgId?: string }).orgId;
    if (!orgId) {
      throw badRequest("Missing orgId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to create workflows");
    }

    const parsed = createWorkflowSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid workflow payload", parsed.error.flatten());
    }

    const workflow = await store.createWorkflow({
      organizationId: orgContext.organizationId,
      name: parsed.data.name,
      dsl: parsed.data.dsl,
      createdByUserId: auth.userId,
    });

    return reply.status(201).send({ workflow });
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });

    if (!workflow) {
      throw notFound("Workflow not found");
    }

    return { workflow };
  });

  server.post("/v1/orgs/:orgId/workflows/:workflowId/publish", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    if (!["owner", "admin"].includes(orgContext.membership.roleKey)) {
      throw forbidden("Role is not allowed to publish workflows");
    }

    const workflow = await store.publishWorkflow({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }

    return { workflow };
  });

  server.post("/v1/orgs/:orgId/workflows/:workflowId/runs", async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const parsed = createWorkflowRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid workflow run payload", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }
    if (workflow.status !== "published") {
      throw conflict("Workflow must be published before runs can be created");
    }

    const run = await store.createWorkflowRun({
      organizationId: orgContext.organizationId,
      workflowId: workflow.id,
      triggerType: "manual",
      requestedByUserId: auth.userId,
      input: parsed.data.input,
    });

    try {
      await queueProducer.enqueueWorkflowRun({
        payload: {
          runId: run.id,
          organizationId: run.organizationId,
          workflowId: run.workflowId,
          requestedByUserId: run.requestedByUserId,
        },
        maxAttempts: run.maxAttempts,
      });
      server.log.info(
        {
          event: "workflow_run_enqueued",
          userId: auth.userId,
          orgId: orgContext.organizationId,
          workflowId: workflow.id,
          runId: run.id,
          requestId: request.id,
          path: request.url,
          method: request.method,
        },
        "workflow run enqueued"
      );
    } catch (error) {
      await store.deleteQueuedWorkflowRun({
        organizationId: orgContext.organizationId,
        workflowId: workflow.id,
        runId: run.id,
        actorUserId: auth.userId,
      });
      server.log.error(
        {
          event: "queue_unavailable",
          userId: auth.userId,
          orgId: orgContext.organizationId,
          workflowId: workflow.id,
          runId: run.id,
          requestId: request.id,
          path: request.url,
          method: request.method,
          error: error instanceof Error ? error.message : String(error),
        },
        "workflow queue unavailable"
      );
      throw queueUnavailable();
    }

    return reply.status(201).send({ run });
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs/:runId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string; runId?: string };
    if (!params.orgId || !params.workflowId || !params.runId) {
      throw badRequest("Missing orgId, workflowId, or runId");
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const run = await store.getWorkflowRunById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
    });
    if (!run) {
      throw notFound("Workflow run not found");
    }

    return { run };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string };
    if (!params.orgId || !params.workflowId) {
      throw badRequest("Missing orgId or workflowId");
    }

    const parsed = listWorkflowRunsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list runs query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const workflow = await store.getWorkflowById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      actorUserId: auth.userId,
    });
    if (!workflow) {
      throw notFound("Workflow not found");
    }

    const cursorPayload = parsed.data.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(parsed.data.cursor)
      : null;

    const result = await store.listWorkflowRuns({
      organizationId: orgContext.organizationId,
      workflowId: workflow.id,
      actorUserId: auth.userId,
      limit: parsed.data.limit ?? 50,
      cursor: cursorPayload,
    });

    return {
      runs: result.runs,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    };
  });

  server.get("/v1/orgs/:orgId/workflows/:workflowId/runs/:runId/events", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as { orgId?: string; workflowId?: string; runId?: string };
    if (!params.orgId || !params.workflowId || !params.runId) {
      throw badRequest("Missing orgId, workflowId, or runId");
    }

    const parsed = listWorkflowRunEventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid list events query", parsed.error.flatten());
    }

    const orgContext = await requireOrgContext(request, { expectedOrgId: params.orgId });
    const run = await store.getWorkflowRunById({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
    });
    if (!run) {
      throw notFound("Workflow run not found");
    }

    const cursorPayload = parsed.data.cursor
      ? decodeCursor<{ createdAt: string; id: string }>(parsed.data.cursor)
      : null;

    const result = await store.listWorkflowRunEvents({
      organizationId: orgContext.organizationId,
      workflowId: params.workflowId,
      runId: params.runId,
      actorUserId: auth.userId,
      limit: parsed.data.limit ?? 200,
      cursor: cursorPayload,
    });

    return {
      events: result.events,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    };
  });

  server.post("/v1/invitations/:token/accept", async (request) => {
    const auth = requireAuth(request);
    const token = (request.params as { token?: string }).token;
    if (!token) {
      throw badRequest("Missing invitation token");
    }

    const organizationId = parseInvitationTokenOrganizationId(token);
    if (!organizationId) {
      throw badRequest("Invalid invitation token");
    }

    const headerOrgId = request.headers["x-org-id"];
    if (headerOrgId) {
      const parsedHeaderOrgId = parseOrgHeaderValue(headerOrgId);
      if (parsedHeaderOrgId !== organizationId) {
        throw orgContextInvalid("X-Org-Id does not match invitation organization");
      }
    }

    try {
      const result = await store.acceptInvitation({
        organizationId,
        token,
        userId: auth.userId,
        email: auth.email,
      });
      return { result };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      const mapped = invitationErrorToAppError(error);
      server.log.warn(
        {
          event: "invitation_accept_failed",
          tokenPrefix: token.slice(0, 8),
          reasonCode: mapped.payload.code,
          userId: auth.userId,
          requestId: request.id,
          path: request.url,
        },
        "invitation accept failed"
      );
      throw mapped;
    }
  });

  server.get("/healthz", async () => ({ ok: true }));

  return server;
}
