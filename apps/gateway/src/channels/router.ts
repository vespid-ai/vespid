import type { ChannelInboundEnvelope, ChannelMessageEventType } from "@vespid/shared";

type WorkflowMatchInput = {
  id: string;
  status: string;
  createdByUserId: string;
  dsl: unknown;
};

type TriggerChannelConfig = {
  channelId: string;
  accountKey?: string;
  event?: ChannelMessageEventType;
  match?: {
    textContains?: string;
    senderIn?: string[];
    groupIn?: string[];
  };
};

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseTriggerChannelConfig(dsl: unknown): TriggerChannelConfig | null {
  const dslObj = readObject(dsl);
  if (!dslObj) {
    return null;
  }
  const trigger = readObject(dslObj.trigger);
  if (!trigger) {
    return null;
  }
  if (trigger.type !== "trigger.channel") {
    return null;
  }
  const config = readObject(trigger.config);
  if (!config || typeof config.channelId !== "string") {
    return null;
  }
  const parsed: TriggerChannelConfig = {
    channelId: config.channelId,
    ...(typeof config.accountKey === "string" ? { accountKey: config.accountKey } : {}),
    ...(config.event === "message.dm" || config.event === "message.mentioned" || config.event === "message.received"
      ? { event: config.event }
      : {}),
  };
  const match = readObject(config.match);
  if (match) {
    parsed.match = {
      ...(typeof match.textContains === "string" ? { textContains: match.textContains } : {}),
      ...(Array.isArray(match.senderIn)
        ? { senderIn: match.senderIn.filter((value): value is string => typeof value === "string") }
        : {}),
      ...(Array.isArray(match.groupIn)
        ? { groupIn: match.groupIn.filter((value): value is string => typeof value === "string") }
        : {}),
    };
  }
  return parsed;
}

function eventMatches(expected: ChannelMessageEventType | undefined, envelope: ChannelInboundEnvelope): boolean {
  if (!expected || expected === "message.received") {
    return true;
  }
  if (expected === "message.dm") {
    return envelope.event === "message.dm";
  }
  return envelope.mentionMatched || envelope.event === "message.mentioned";
}

function textContainsMatches(needle: string | undefined, text: string): boolean {
  if (!needle || needle.trim().length === 0) {
    return true;
  }
  return text.toLowerCase().includes(needle.trim().toLowerCase());
}

function inListMatches(values: string[] | undefined, target: string): boolean {
  if (!values || values.length === 0) {
    return true;
  }
  return values.includes(target);
}

export function collectChannelTriggeredWorkflows(input: {
  workflows: WorkflowMatchInput[];
  envelope: ChannelInboundEnvelope;
  accountKey: string;
}): Array<{ workflowId: string; requestedByUserId: string }> {
  const matches: Array<{ workflowId: string; requestedByUserId: string }> = [];

  for (const workflow of input.workflows) {
    if (workflow.status !== "published") {
      continue;
    }
    const config = parseTriggerChannelConfig(workflow.dsl);
    if (!config) {
      continue;
    }
    if (config.channelId !== input.envelope.channelId) {
      continue;
    }
    if (config.accountKey && config.accountKey !== input.accountKey) {
      continue;
    }
    if (!eventMatches(config.event, input.envelope)) {
      continue;
    }
    if (!textContainsMatches(config.match?.textContains, input.envelope.text)) {
      continue;
    }
    if (!inListMatches(config.match?.senderIn, input.envelope.senderId)) {
      continue;
    }
    if (!inListMatches(config.match?.groupIn, input.envelope.conversationId)) {
      continue;
    }
    matches.push({ workflowId: workflow.id, requestedByUserId: workflow.createdByUserId });
  }

  return matches;
}
