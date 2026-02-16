import { describe, expect, it } from "vitest";
import type { ChannelInboundEnvelope } from "@vespid/shared";
import { evaluateChannelSecurity } from "./security.js";

const baseEnvelope: ChannelInboundEnvelope = {
  channelId: "telegram",
  accountId: "a1",
  accountKey: "main",
  organizationId: "o1",
  providerMessageId: "m1",
  conversationId: "c1",
  senderId: "u1",
  text: "hello",
  receivedAt: new Date().toISOString(),
  mentionMatched: false,
  event: "message.dm",
};

describe("channel security", () => {
  it("requires pairing for DM by default", () => {
    const decision = evaluateChannelSecurity({
      envelope: baseEnvelope,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      requireMentionInGroup: true,
      allowlistEntries: [],
    });
    expect(decision.accepted).toBe(false);
    expect(decision.requiresPairing).toBe(true);
  });

  it("allows DM when sender is in allowlist", () => {
    const decision = evaluateChannelSecurity({
      envelope: baseEnvelope,
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      requireMentionInGroup: true,
      allowlistEntries: [{ scope: "sender", subject: "u1" }],
    });
    expect(decision.accepted).toBe(true);
  });

  it("requires wildcard for open policy", () => {
    const decision = evaluateChannelSecurity({
      envelope: baseEnvelope,
      dmPolicy: "open",
      groupPolicy: "allowlist",
      requireMentionInGroup: true,
      allowlistEntries: [],
    });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("dm_open_requires_wildcard");
  });
});
