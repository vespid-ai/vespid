import type { ChannelDmPolicy, ChannelGroupPolicy, ChannelInboundEnvelope } from "@vespid/shared";

export type ChannelAllowlistEntry = {
  scope: string;
  subject: string;
};

export type ChannelSecurityDecision = {
  accepted: boolean;
  reason:
    | "accepted"
    | "dm_disabled"
    | "dm_pairing_required"
    | "dm_allowlist_denied"
    | "dm_open_requires_wildcard"
    | "group_disabled"
    | "group_mention_required"
    | "group_allowlist_denied"
    | "group_open_requires_wildcard";
  requiresPairing: boolean;
};

function hasEntry(entries: ChannelAllowlistEntry[], scope: string, subject: string): boolean {
  const normalizedScope = scope.trim().toLowerCase();
  return entries.some((entry) => {
    const entryScope = entry.scope.trim().toLowerCase();
    if (entryScope !== normalizedScope) {
      return false;
    }
    return entry.subject === subject;
  });
}

function wildcardAllowed(entries: ChannelAllowlistEntry[], scopes: string[]): boolean {
  return scopes.some((scope) => hasEntry(entries, scope, "*"));
}

function senderAllowed(entries: ChannelAllowlistEntry[], senderId: string, extraScopes: string[]): boolean {
  const scopes = ["sender", ...extraScopes];
  return scopes.some((scope) => hasEntry(entries, scope, senderId));
}

export function evaluateChannelSecurity(input: {
  envelope: ChannelInboundEnvelope;
  dmPolicy: ChannelDmPolicy;
  groupPolicy: ChannelGroupPolicy;
  requireMentionInGroup: boolean;
  allowlistEntries: ChannelAllowlistEntry[];
}): ChannelSecurityDecision {
  const isDm = input.envelope.event === "message.dm";
  const senderId = input.envelope.senderId;
  const conversationId = input.envelope.conversationId;
  const senderAllowedForDm = senderAllowed(input.allowlistEntries, senderId, ["dm"]);
  const senderAllowedForGroup = senderAllowed(input.allowlistEntries, senderId, ["group"]);
  const groupAllowed =
    hasEntry(input.allowlistEntries, "group", conversationId) ||
    hasEntry(input.allowlistEntries, "conversation", conversationId) ||
    senderAllowedForGroup;

  if (isDm) {
    if (input.dmPolicy === "disabled") {
      return { accepted: false, reason: "dm_disabled", requiresPairing: false };
    }

    if (input.dmPolicy === "pairing") {
      if (!senderAllowedForDm) {
        return { accepted: false, reason: "dm_pairing_required", requiresPairing: true };
      }
      return { accepted: true, reason: "accepted", requiresPairing: false };
    }

    if (input.dmPolicy === "allowlist") {
      if (!senderAllowedForDm) {
        return { accepted: false, reason: "dm_allowlist_denied", requiresPairing: false };
      }
      return { accepted: true, reason: "accepted", requiresPairing: false };
    }

    const openWildcard = wildcardAllowed(input.allowlistEntries, ["dm", "sender"]);
    if (!openWildcard) {
      return { accepted: false, reason: "dm_open_requires_wildcard", requiresPairing: false };
    }
    return { accepted: true, reason: "accepted", requiresPairing: false };
  }

  if (input.groupPolicy === "disabled") {
    return { accepted: false, reason: "group_disabled", requiresPairing: false };
  }

  if (input.requireMentionInGroup && !input.envelope.mentionMatched) {
    return { accepted: false, reason: "group_mention_required", requiresPairing: false };
  }

  if (input.groupPolicy === "allowlist" && !groupAllowed) {
    return { accepted: false, reason: "group_allowlist_denied", requiresPairing: false };
  }

  if (input.groupPolicy === "open") {
    const openWildcard = wildcardAllowed(input.allowlistEntries, ["group", "conversation", "sender"]);
    if (!openWildcard) {
      return { accepted: false, reason: "group_open_requires_wildcard", requiresPairing: false };
    }
  }

  return { accepted: true, reason: "accepted", requiresPairing: false };
}
