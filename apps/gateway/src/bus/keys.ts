export function streamToBrain(): string {
  return "gateway:bus:to_brain";
}

export function streamToEdge(edgeId: string): string {
  return `gateway:bus:to_edge:${edgeId}`;
}

export function replyKey(requestId: string): string {
  return `gateway:bus:reply:${requestId}`;
}

export function executorRouteKey(executorId: string): string {
  return `executor:route:${executorId}`;
}

export function executorInFlightKey(executorId: string): string {
  return `executor:inflight:${executorId}`;
}

export function orgInFlightKey(orgId: string): string {
  return `org:quota:${orgId}:inflight`;
}

export function executorLastUsedKey(executorId: string): string {
  return `executor:last_used:${executorId}`;
}

export function sessionEdgesKey(sessionId: string): string {
  return `session:edges:${sessionId}`;
}

export function sessionBrainKey(sessionId: string): string {
  return `session:brain:${sessionId}`;
}
