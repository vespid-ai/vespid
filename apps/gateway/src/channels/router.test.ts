import { describe, expect, it } from "vitest";
import type { ChannelInboundEnvelope } from "@vespid/shared";
import { collectChannelTriggeredWorkflows } from "./router.js";

const envelope: ChannelInboundEnvelope = {
  channelId: "telegram",
  accountId: "a1",
  accountKey: "main",
  organizationId: "o1",
  providerMessageId: "m1",
  conversationId: "group-1",
  senderId: "u1",
  senderDisplayName: "U1",
  text: "deploy please",
  receivedAt: new Date().toISOString(),
  mentionMatched: true,
  event: "message.mentioned",
  raw: {},
};

describe("channel workflow router", () => {
  it("matches trigger.channel config", () => {
    const matches = collectChannelTriggeredWorkflows({
      envelope,
      accountKey: "main",
      workflows: [
        {
          id: "wf-1",
          status: "published",
          createdByUserId: "user-1",
          dsl: {
            version: "v2",
            trigger: {
              type: "trigger.channel",
              config: {
                channelId: "telegram",
                accountKey: "main",
                event: "message.mentioned",
                match: {
                  textContains: "deploy",
                  senderIn: ["u1"],
                },
              },
            },
            nodes: [{ id: "n1", type: "agent.execute" }],
          },
        },
      ],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ workflowId: "wf-1", requestedByUserId: "user-1" });
  });
});
