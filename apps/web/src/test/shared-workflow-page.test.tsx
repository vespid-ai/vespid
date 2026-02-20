import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import SharedWorkflowPage from "../app/[locale]/(app)/shared-workflows/[shareId]/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createRun: vi.fn(async () => ({ run: { id: "run_2" } })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ locale: "en", shareId: "share_1" }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({
    isLoading: false,
    data: { session: { token: "tok", expiresAt: 1 } },
    refetch: vi.fn(),
  }),
}));

vi.mock("../lib/hooks/use-workflow-shares", () => ({
  useSharedWorkflow: () => ({
    isLoading: false,
    data: {
      share: {
        id: "share_1",
        organizationId: "org_1",
        workflowId: "wf_1",
        userId: "user_1",
        accessRole: "runner",
        sourceInvitationId: "inv_1",
        createdByUserId: "owner_1",
        revokedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      },
      workflow: {
        id: "wf_1",
        name: "Production Incident Triage",
        status: "published",
      },
    },
  }),
  useSharedWorkflowRuns: () => ({
    isLoading: false,
    data: {
      runs: [
        {
          id: "run_1",
          status: "succeeded",
          createdAt: "2026-02-20T00:10:00.000Z",
        },
      ],
    },
  }),
  useSharedWorkflowRunEvents: () => ({
    isLoading: false,
    data: {
      events: [
        {
          id: "evt_1",
          eventType: "run.started",
          message: "Run started",
          createdAt: "2026-02-20T00:10:01.000Z",
        },
      ],
    },
  }),
  useCreateSharedWorkflowRun: () => ({
    mutateAsync: mocks.createRun,
    isPending: false,
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("SharedWorkflowPage", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.createRun.mockClear();
  });

  it("renders runner-only view and triggers shared run", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SharedWorkflowPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Production Incident Triage")).toBeInTheDocument();
    expect(screen.getByText(messages.workflows.share.shared.subtitle)).toBeInTheDocument();
    expect(screen.queryByText(messages.workflows.detail.publish)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: messages.workflows.share.shared.runAction }));
    await waitFor(() => expect(mocks.createRun).toHaveBeenCalledWith({ input: {} }));
  });
});
