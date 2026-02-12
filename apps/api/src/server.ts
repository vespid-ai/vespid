import Fastify from "fastify";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  signAuthToken,
  unauthorized,
  verifyAuthToken,
  type AppError,
} from "@vespid/shared";
import { z } from "zod";
import type { AppStore } from "./types.js";
import { createStore } from "./store/index.js";
import { hashPassword, verifyPassword } from "./security.js";

type AuthContext = {
  userId: string;
  email: string;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const oauthSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(120).optional(),
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
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

export async function buildServer(input?: { store?: AppStore }) {
  const server = Fastify({ logger: false });
  const store = input?.store ?? createStore();
  await store.ensureDefaultRoles();

  const authSecret = process.env.AUTH_TOKEN_SECRET ?? "dev-auth-secret";

  server.setErrorHandler((error, _request, reply) => {
    const appError = error as Partial<AppError> & { payload?: unknown };
    if (typeof appError.statusCode === "number" && appError.payload) {
      return reply.status(appError.statusCode).send(appError.payload);
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });

  server.addHook("preHandler", async (request) => {
    const token = parseAuthHeader(request.headers.authorization);
    if (!token) {
      return;
    }
    const payload = verifyAuthToken(token, authSecret);
    if (!payload) {
      return;
    }
    request.auth = { userId: payload.userId, email: payload.email };
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

    const session = signAuthToken({
      userId: user.id,
      email: user.email,
      secret: authSecret,
    });

    return reply.status(201).send({ session, user: toPublicUser(user) });
  });

  server.post("/v1/auth/login", async (request) => {
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

    const session = signAuthToken({ userId: user.id, email: user.email, secret: authSecret });
    return { session, user: toPublicUser(user) };
  });

  server.post("/v1/auth/oauth/:provider/callback", async (request, reply) => {
    const provider = z.enum(["google", "github"]).safeParse((request.params as { provider?: string }).provider);
    if (!provider.success) {
      throw badRequest("Unsupported OAuth provider");
    }

    const parsed = oauthSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid OAuth payload", parsed.error.flatten());
    }

    if (parsed.data.state !== "valid-oauth-state") {
      throw unauthorized("Invalid OAuth state");
    }

    const email = parsed.data.email ?? `${provider.data}+${parsed.data.code}@oauth.local`;
    const existing = await store.getUserByEmail(email);
    const user =
      existing ??
      (await store.createUser({
        email,
        passwordHash: await hashPassword(`oauth:${provider.data}:${parsed.data.code}`),
        displayName: parsed.data.displayName ?? provider.data ?? null,
      }));

    const session = signAuthToken({ userId: user.id, email: user.email, secret: authSecret });
    return reply.status(200).send({ session, user: toPublicUser(user), provider: provider.data });
  });

  function requireAuth(request: { auth?: AuthContext }): AuthContext {
    if (!request.auth) {
      throw unauthorized();
    }
    return request.auth;
  }

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

    const actorMembership = await store.getMembership({ organizationId: orgId, userId: auth.userId });
    if (!actorMembership) {
      throw forbidden("Not a member of this organization");
    }

    if (!["owner", "admin"].includes(actorMembership.roleKey)) {
      throw forbidden("Role is not allowed to invite members");
    }

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid invitation payload", parsed.error.flatten());
    }

    const invitation = await store.createInvitation({
      organizationId: orgId,
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

    const actorMembership = await store.getMembership({ organizationId: params.orgId, userId: auth.userId });
    if (!actorMembership) {
      throw forbidden("Not a member of this organization");
    }

    if (!["owner", "admin"].includes(actorMembership.roleKey)) {
      throw forbidden("Role is not allowed to change membership roles");
    }

    const parsed = roleMutationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("Invalid role update payload", parsed.error.flatten());
    }

    if (parsed.data.roleKey === "owner" && actorMembership.roleKey !== "owner") {
      throw forbidden("Only owner can assign owner role");
    }

    const updated = await store.updateMembershipRole({
      organizationId: params.orgId,
      memberUserId: params.memberId,
      roleKey: parsed.data.roleKey,
    });

    if (!updated) {
      throw notFound("Membership not found");
    }

    return { membership: updated };
  });

  server.get("/healthz", async () => ({ ok: true }));

  return server;
}
