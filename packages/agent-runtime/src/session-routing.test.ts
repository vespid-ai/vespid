import { describe, expect, it } from "vitest";
import { buildSessionKey, resolveRoutedAgent } from "./session-routing.js";

describe("session routing", () => {
  it("builds deterministic keys by scope", () => {
    expect(
      buildSessionKey({
        agentId: "support",
        organizationId: "org-1",
        scope: "main",
        actorUserId: "u-1",
      })
    ).toBe("agent:support:org:org-1:scope:main");

    expect(
      buildSessionKey({
        agentId: "support",
        organizationId: "org-1",
        scope: "per-channel-peer",
        actorUserId: "u-1",
        channel: "slack",
        peer: "alice",
      })
    ).toBe("agent:support:org:org-1:scope:per-channel-peer:channel:slack:peer:alice");
  });

  it("resolves by precedence and priority", () => {
    const resolved = resolveRoutedAgent({
      defaultAgentId: "default",
      context: {
        organizationId: "org-1",
        actorUserId: "u-1",
        scope: "main",
        peer: "alice",
        orgRoles: ["member"],
      },
      bindings: [
        {
          id: "b3",
          organizationId: "org-1",
          agentId: "role-agent",
          priority: 1,
          dimension: "org_roles",
          match: { orgRoles: ["member"] },
          createdByUserId: "u-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "b1",
          organizationId: "org-1",
          agentId: "peer-agent",
          priority: 1,
          dimension: "peer",
          match: { peer: "alice" },
          createdByUserId: "u-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    expect(resolved.routedAgentId).toBe("peer-agent");
    expect(resolved.bindingId).toBe("b1");
    expect(resolved.sessionKey.startsWith("agent:peer-agent")).toBe(true);
  });
});
