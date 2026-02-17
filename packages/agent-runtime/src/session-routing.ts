import type {
  AgentBindingRecord,
  BindingDimension,
  SessionRouteContext,
  SessionRouteResolved,
  SessionScope,
} from "@vespid/shared";

const bindingOrder: BindingDimension[] = [
  "peer",
  "parent_peer",
  "org_roles",
  "organization",
  "team",
  "account",
  "channel",
  "default",
];

function normalizePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function safePart(value: string | null | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const normalized = normalizePart(value);
  return normalized.length > 0 ? normalized : fallback;
}

function roleListKey(roles: string[] | undefined): string {
  if (!Array.isArray(roles) || roles.length === 0) {
    return "none";
  }
  return roles
    .map((r) => normalizePart(r))
    .filter((r) => r.length > 0)
    .sort()
    .join("+");
}

export function buildSessionKey(input: {
  agentId: string;
  organizationId: string;
  scope: SessionScope;
  actorUserId: string;
  channel?: string | null;
  account?: string | null;
  peer?: string | null;
}): string {
  const agentPart = safePart(input.agentId, "default");
  const orgPart = safePart(input.organizationId, "unknown-org");
  const scopePart = safePart(input.scope, "main");
  const peerPart = safePart(input.peer ?? input.actorUserId, "anonymous");
  const channelPart = safePart(input.channel, "unknown-channel");
  const accountPart = safePart(input.account, "unknown-account");

  const base = `agent:${agentPart}:org:${orgPart}:scope:${scopePart}`;

  if (scopePart === "per-peer") {
    return `${base}:peer:${peerPart}`;
  }
  if (scopePart === "per-channel-peer") {
    return `${base}:channel:${channelPart}:peer:${peerPart}`;
  }
  if (scopePart === "per-account-channel-peer") {
    return `${base}:account:${accountPart}:channel:${channelPart}:peer:${peerPart}`;
  }
  return base;
}

function dimensionsRank(dimension: BindingDimension): number {
  const index = bindingOrder.indexOf(dimension);
  return index >= 0 ? index : bindingOrder.length;
}

function matchesBinding(binding: AgentBindingRecord, context: SessionRouteContext): boolean {
  const match = binding.match ?? {};
  const dimension = binding.dimension;

  if (dimension === "peer") {
    return Boolean(match.peer && context.peer && match.peer === context.peer);
  }

  if (dimension === "parent_peer") {
    return Boolean(match.parentPeer && context.parentPeer && match.parentPeer === context.parentPeer);
  }

  if (dimension === "org_roles") {
    const targetRoles = Array.isArray(match.orgRoles) ? match.orgRoles : [];
    if (targetRoles.length === 0) {
      return false;
    }
    const actual = new Set(context.orgRoles ?? []);
    return targetRoles.some((role) => actual.has(role));
  }

  if (dimension === "organization") {
    return Boolean(match.organizationId && match.organizationId === context.organizationId);
  }

  if (dimension === "team") {
    return Boolean(match.teamId && context.team && match.teamId === context.team);
  }

  if (dimension === "account") {
    return Boolean(match.accountId && context.account && match.accountId === context.account);
  }

  if (dimension === "channel") {
    return Boolean(match.channelId && context.channel && match.channelId === context.channel);
  }

  return dimension === "default";
}

export function resolveRoutedAgent(input: {
  bindings: AgentBindingRecord[];
  context: SessionRouteContext;
  defaultAgentId: string;
}): SessionRouteResolved {
  const candidates = input.bindings
    .filter((binding) => binding.organizationId === input.context.organizationId)
    .filter((binding) => matchesBinding(binding, input.context))
    .sort((left, right) => {
      const dimRank = dimensionsRank(left.dimension) - dimensionsRank(right.dimension);
      if (dimRank !== 0) {
        return dimRank;
      }
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return left.id.localeCompare(right.id);
    });

  const selected = candidates[0] ?? null;
  const routedAgentId = selected?.agentId ?? input.defaultAgentId;
  const sessionKey = buildSessionKey({
    agentId: routedAgentId,
    organizationId: input.context.organizationId,
    scope: input.context.scope,
    actorUserId: input.context.actorUserId,
    ...(input.context.channel !== undefined ? { channel: input.context.channel } : {}),
    ...(input.context.account !== undefined ? { account: input.context.account } : {}),
    ...(input.context.peer !== undefined ? { peer: input.context.peer } : {}),
  });

  return {
    routedAgentId,
    sessionKey,
    ...(selected ? { bindingId: selected.id } : {}),
  };
}

export function getRoutingDebugKey(context: SessionRouteContext): string {
  return [
    `org:${safePart(context.organizationId, "unknown")}`,
    `scope:${safePart(context.scope, "main")}`,
    `peer:${safePart(context.peer ?? context.actorUserId, "anonymous")}`,
    `channel:${safePart(context.channel, "none")}`,
    `account:${safePart(context.account, "none")}`,
    `team:${safePart(context.team, "none")}`,
    `roles:${roleListKey(context.orgRoles)}`,
  ].join(":");
}
