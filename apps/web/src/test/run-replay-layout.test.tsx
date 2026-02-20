import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import RunReplayPage from "../app/[locale]/(app)/workflows/[workflowId]/runs/[runId]/page";

const mocks = vi.hoisted(() => ({
  panelGroups: [] as Array<{
    defaultLayout: Record<string, number> | undefined;
    onLayoutChanged: ((layout: Record<string, number>) => void) | undefined;
  }>,
  panels: [] as Array<{ id: string | undefined; defaultSize: number | undefined; minSize: number | undefined }>,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({
    children,
    defaultLayout,
    onLayoutChanged,
  }: {
    children?: ReactNode;
    defaultLayout?: Record<string, number>;
    onLayoutChanged?: (layout: Record<string, number>) => void;
  }) => {
    mocks.panelGroups.push({ defaultLayout, onLayoutChanged });
    return <div data-testid="mock-panel-group">{children}</div>;
  },
  Panel: ({
    children,
    id,
    defaultSize,
    minSize,
  }: {
    children?: ReactNode;
    id?: string;
    defaultSize?: number;
    minSize?: number;
  }) => {
    mocks.panels.push({ id, defaultSize, minSize });
    return <div>{children}</div>;
  },
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
        startedAt: "2026-02-20T03:31:47.349Z",
        endedAt: "2026-02-20T03:33:47.349Z",
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
          eventType: "run_started",
          nodeId: "root",
          createdAt: "2026-02-20T03:31:47.349Z",
          payload: {
            input: { hello: "world" },
            output: { ok: true },
            error: null,
          },
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

describe("Run replay layout", () => {
  beforeEach(() => {
    mocks.panelGroups.length = 0;
    mocks.panels.length = 0;
    window.localStorage.clear();
  });

  it("uses persisted panel layout and updated panel size defaults", async () => {
    const messages = readMessages("en");
    window.localStorage.setItem(
      "vespid.ui.run-replay-layout.v1",
      JSON.stringify({ timeline: 20, details: 45, inspector: 35 })
    );

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RunReplayPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("mock-panel-group")).toBeInTheDocument();
    const latestGroup = mocks.panelGroups[mocks.panelGroups.length - 1];
    expect(latestGroup?.defaultLayout).toEqual({ timeline: 20, details: 45, inspector: 35 });
    expect(typeof latestGroup?.onLayoutChanged).toBe("function");

    act(() => {
      latestGroup?.onLayoutChanged?.({ timeline: 24, details: 38, inspector: 38 });
    });
    expect(window.localStorage.getItem("vespid.ui.run-replay-layout.v1")).toBe(
      JSON.stringify({ timeline: 24, details: 38, inspector: 38 })
    );

    const latestPanels = mocks.panels.slice(-3);
    expect(latestPanels).toEqual([
      { id: "timeline", defaultSize: 24, minSize: 18 },
      { id: "details", defaultSize: 38, minSize: 24 },
      { id: "inspector", defaultSize: 38, minSize: 30 },
    ]);
  });

  it("renders inspector I/O sections in a single-column stack", async () => {
    const messages = readMessages("en");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RunReplayPage />
      </NextIntlClientProvider>
    );

    const ioSections = await screen.findByTestId("run-replay-io-sections");
    expect(ioSections.className).not.toContain("md:grid-cols-2");

    expect(screen.getByText(messages.runs.sectionInputs)).toBeInTheDocument();
    expect(screen.getByText(messages.runs.sectionOutputs)).toBeInTheDocument();
    expect(screen.getByText(messages.runs.sectionErrors)).toBeInTheDocument();
  });
});
