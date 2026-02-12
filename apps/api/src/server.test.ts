import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { MemoryAppStore } from "./store/memory-store.js";

describe("api foundation", () => {
  const store = new MemoryAppStore();
  let server: Awaited<ReturnType<typeof buildServer>>;

  it("signup works and login fails with wrong password", async () => {
    server = await buildServer({ store });

    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "owner@example.com",
        password: "Password123",
        displayName: "Owner",
      },
    });

    expect(signup.statusCode).toBe(201);
    const signupBody = signup.json() as { session: { token: string } };
    expect(signupBody.session.token.length).toBeGreaterThan(10);

    const loginBad = await server.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "wrong-password",
      },
    });

    expect(loginBad.statusCode).toBe(401);
  });

  it("oauth callback accepts valid state and rejects invalid state", async () => {
    const invalid = await server.inject({
      method: "POST",
      url: "/v1/auth/oauth/google/callback",
      payload: {
        code: "oauth-code",
        state: "bad",
      },
    });
    expect(invalid.statusCode).toBe(401);

    const valid = await server.inject({
      method: "POST",
      url: "/v1/auth/oauth/google/callback",
      payload: {
        code: "oauth-code",
        state: "valid-oauth-state",
      },
    });

    expect(valid.statusCode).toBe(200);
  });

  it("creates org with default owner membership", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "org-owner@example.com",
        password: "Password123",
      },
    });

    const token = (signup.json() as { session: { token: string } }).session.token;
    const org = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Test Org",
        slug: "test-org",
      },
    });

    expect(org.statusCode).toBe(201);
    const body = org.json() as {
      membership: { roleKey: string; userId: string };
      organization: { id: string };
    };
    expect(body.membership.roleKey).toBe("owner");
    expect(body.membership.userId.length).toBeGreaterThan(10);
  });

  it("allows invite by owner and rejects role mutation by member", async () => {
    const ownerSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "invite-owner@example.com",
        password: "Password123",
      },
    });
    const ownerToken = (ownerSignup.json() as { session: { token: string } }).session.token;
    const ownerUser = ownerSignup.json() as { user: { id: string } };

    const orgRes = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Invite Org",
        slug: `invite-org-${Date.now()}`,
      },
    });

    const orgBody = orgRes.json() as { organization: { id: string } };
    const orgId = orgBody.organization.id;

    const invite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        email: "member@example.com",
        roleKey: "member",
      },
    });

    expect(invite.statusCode).toBe(201);

    const memberSignup = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "member@example.com",
        password: "Password123",
      },
    });
    const memberBody = memberSignup.json() as { user: { id: string }; session: { token: string } };

    await store.attachMembership({
      organizationId: orgId,
      userId: memberBody.user.id,
      roleKey: "member",
    });

    const roleMutation = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/members/${ownerUser.user.id}/role`,
      headers: { authorization: `Bearer ${memberBody.session.token}` },
      payload: {
        roleKey: "admin",
      },
    });

    expect(roleMutation.statusCode).toBe(403);
  });

  it("blocks cross-org access", async () => {
    const userA = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "cross-a@example.com", password: "Password123" },
    });
    const userAToken = (userA.json() as { session: { token: string } }).session.token;

    const userB = await server.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "cross-b@example.com", password: "Password123" },
    });
    const userBToken = (userB.json() as { session: { token: string } }).session.token;

    const orgA = await server.inject({
      method: "POST",
      url: "/v1/orgs",
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        name: "Cross Org A",
        slug: `cross-org-a-${Date.now()}`,
      },
    });
    const orgId = (orgA.json() as { organization: { id: string } }).organization.id;

    const forbiddenInvite = await server.inject({
      method: "POST",
      url: `/v1/orgs/${orgId}/invitations`,
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        email: "x@example.com",
        roleKey: "member",
      },
    });

    expect(forbiddenInvite.statusCode).toBe(403);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });
});
