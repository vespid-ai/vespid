import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import RunReplayPage from "../app/[locale]/(app)/workflows/[workflowId]/runs/[runId]/page";

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "en", workflowId: "wf_1", runId: "run_1" }),
}));

vi.mock("../lib/hooks/use-active-org-name", () => ({
  useActiveOrgName: () => ({ orgId: "org_1", orgName: "Demo Org" }),
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: Date.now() + 60_000 } } }),
}));

vi.mock("../lib/hooks/use-workflows", () => ({
  useRun: () => ({
    data: {
      run: {
        id: "run_1",
        status: "running",
        startedAt: "2026-02-19T12:00:00.000Z",
        endedAt: null,
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRunEvents: () => ({
    data: {
      events: [
        {
          id: "event_1",
          eventType: "node_dispatched",
          nodeId: "n1",
          createdAt: "2026-02-19T12:00:01.000Z",
          payload: { requestId: "req-1", kind: "agent.run" },
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock("../lib/recents", () => ({
  addRecentRunId: vi.fn(),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Run replay pending remote state", () => {
  it("shows waiting status when node is dispatched and callback is pending", async () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RunReplayPage />
      </NextIntlClientProvider>
    );

    const status = await screen.findByTestId("run-replay-pending-remote-status");
    expect(status).toBeInTheDocument();
    expect(within(status).getByText(messages.runs.pendingRemote.badge)).toBeInTheDocument();
    expect(within(status).getByText("Node: n1")).toBeInTheDocument();
  });
});
