#!/usr/bin/env node

import WebSocket, { type RawData } from "ws";
import { z } from "zod";

function usage(): never {
  // Keep it simple and stable. This CLI is intentionally minimal.
  // Examples:
  //   vespid session list --api http://localhost:3001 --org <orgId> --token <accessToken>
  //   vespid session create --api ... --org ... --token ... --title "My session" --model gpt-4.1-mini --instructions "..."
  //   vespid session send --gateway ws://localhost:3002/ws/client --org ... --token ... --session <sessionId> --message "hi"
  // eslint-disable-next-line no-console
  console.log(
    [
      "vespid (CLI)",
      "",
      "Commands:",
      "  vespid session list --api <url> --org <orgId> --token <accessToken>",
      "  vespid session create --api <url> --org <orgId> --token <accessToken> --model <model> --instructions <text> [--title <text>] [--engine gateway.loop.v2|gateway.codex.v2|gateway.claude.v2] [--provider openai|anthropic] [--toolset <toolsetId>] [--tag <selectorTag>] [--tools <comma-separated>]",
      "  vespid session send --gateway <wsUrl> --org <orgId> --token <accessToken> --session <sessionId> --message <text> [--timeout-ms <ms>]",
      "",
      "Notes:",
      "- For security, do not paste tokens into shell history in shared environments.",
      "- WebSocket auth uses Authorization bearer + X-Org-Id headers (CLI only).",
    ].join("\n")
  );
  process.exit(2);
}

function argValue(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  const v = args[idx + 1];
  return typeof v === "string" ? v : null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseCommaList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function apiFetchJson<T>(input: {
  apiBase: string;
  token: string;
  orgId: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
}): Promise<T> {
  const url = `${input.apiBase.replace(/\/+$/, "")}${input.path}`;
  const init: RequestInit = {
    method: input.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
      "x-org-id": input.orgId,
    },
  };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  const payload = text.length ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && "message" in payload && typeof (payload as any).message === "string"
        ? String((payload as any).message)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return payload as T;
}

async function cmdSessionList(args: string[]) {
  const apiBase = argValue(args, "--api");
  const orgId = argValue(args, "--org");
  const token = argValue(args, "--token");
  if (!apiBase || !orgId || !token) usage();

  const out = await apiFetchJson<{ sessions: Array<{ id: string; title: string; engineId: string; llmProvider: string; llmModel: string; status: string; updatedAt: string }>; nextCursor: string | null }>({
    apiBase,
    orgId,
    token,
    path: `/v1/orgs/${orgId}/sessions?limit=100`,
    method: "GET",
  });

  for (const s of out.sessions ?? []) {
    // eslint-disable-next-line no-console
    console.log(`${s.id}  ${s.status}  ${s.engineId}  ${s.llmProvider}:${s.llmModel}  ${s.title || ""}`);
  }
}

async function cmdSessionCreate(args: string[]) {
  const apiBase = argValue(args, "--api");
  const orgId = argValue(args, "--org");
  const token = argValue(args, "--token");
  const model = argValue(args, "--model");
  const instructions = argValue(args, "--instructions");
  if (!apiBase || !orgId || !token || !model || !instructions) usage();

  const engine = (argValue(args, "--engine") ?? "gateway.loop.v2") as "gateway.loop.v2" | "gateway.codex.v2" | "gateway.claude.v2";
  const provider = (argValue(args, "--provider") ?? "openai") as "openai" | "anthropic";
  const title = argValue(args, "--title") ?? "";
  const system = argValue(args, "--system") ?? "";
  const toolsetId = argValue(args, "--toolset");
  const selectorTag = argValue(args, "--tag");
  const tools = parseCommaList(argValue(args, "--tools"));

  const payload = {
    ...(title.trim().length ? { title: title.trim() } : {}),
    engineId: engine,
    ...(toolsetId && toolsetId.trim().length ? { toolsetId: toolsetId.trim() } : {}),
    llm: { provider: engine === "gateway.codex.v2" ? "openai" : engine === "gateway.claude.v2" ? "anthropic" : provider, model: model.trim() },
    prompt: { ...(system.trim().length ? { system: system.trim() } : {}), instructions: instructions.trim() },
    tools: { allow: tools },
    ...(selectorTag && selectorTag.trim().length ? { executorSelector: { pool: "managed", tag: selectorTag.trim() } } : {}),
  };

  const out = await apiFetchJson<{ session: { id: string } }>({
    apiBase,
    orgId,
    token,
    path: `/v1/orgs/${orgId}/sessions`,
    method: "POST",
    body: payload,
  });

  // eslint-disable-next-line no-console
  console.log(out.session.id);
}

async function cmdSessionSend(args: string[]) {
  const gateway = argValue(args, "--gateway") ?? "ws://localhost:3002/ws/client";
  const orgId = argValue(args, "--org");
  const token = argValue(args, "--token");
  const sessionId = argValue(args, "--session");
  const message = argValue(args, "--message");
  const timeoutMs = clampInt(argValue(args, "--timeout-ms"), 60_000, 1000, 10 * 60_000);
  if (!orgId || !token || !sessionId || !message) usage();

  const ws = new WebSocket(`${gateway}?orgId=${encodeURIComponent(orgId)}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-org-id": orgId,
    },
  });

  const eventSchema = z.object({
    type: z.literal("session_event_v2"),
    sessionId: z.string(),
    seq: z.number().int(),
    eventType: z.string(),
    level: z.enum(["info", "warn", "error"]),
    payload: z.unknown().optional(),
    createdAt: z.string(),
  });
  const errorSchema = z.object({
    type: z.literal("session_error"),
    code: z.string(),
    message: z.string(),
  });

  let done = false;
  const timeout = setTimeout(() => {
    if (done) return;
    done = true;
    try {
      ws.close();
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error("Timed out waiting for session response.");
    process.exit(1);
  }, timeoutMs);

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "client_hello", clientVersion: "cli" }));
    ws.send(JSON.stringify({ type: "session_join", sessionId }));
    ws.send(
      JSON.stringify({
        type: "session_send",
        sessionId,
        message,
        idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      })
    );
  });

  ws.on("message", (data: RawData) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    const parsed = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    if (!parsed) return;

    const err = errorSchema.safeParse(parsed);
    if (err.success) {
      // eslint-disable-next-line no-console
      console.error(`${err.data.code}: ${err.data.message}`);
      return;
    }

    const ev = eventSchema.safeParse(parsed);
    if (!ev.success) return;
    if (ev.data.sessionId !== sessionId) return;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          seq: ev.data.seq,
          eventType: ev.data.eventType,
          level: ev.data.level,
          createdAt: ev.data.createdAt,
          payload: ev.data.payload ?? null,
        },
        null,
        2
      )
    );

    if (ev.data.eventType === "agent_final" || ev.data.eventType === "error") {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore
      }
      process.exit(0);
    }
  });

  ws.on("error", (err: Error) => {
    if (done) return;
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
  });

  ws.on("close", () => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "";
  const sub = args[1] ?? "";
  if (!cmd) usage();

  if (cmd === "session" && sub === "list") {
    await cmdSessionList(args.slice(2));
    return;
  }
  if (cmd === "session" && sub === "create") {
    await cmdSessionCreate(args.slice(2));
    return;
  }
  if (cmd === "session" && sub === "send") {
    await cmdSessionSend(args.slice(2));
    return;
  }

  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    usage();
  }

  usage();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
