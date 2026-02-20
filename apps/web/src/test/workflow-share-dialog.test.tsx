import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { WorkflowShareDialog } from "../components/app/workflows/workflow-share-dialog";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(async () => ({
    invitation: {
      id: "inv_1",
      organizationId: "org_1",
      workflowId: "wf_1",
      email: "mangaohua@gmail.com",
      accessRole: "runner",
      token: "token_1",
      status: "pending",
      invitedByUserId: "owner_1",
      acceptedByUserId: null,
      expiresAt: "2026-02-22T00:00:00.000Z",
      acceptedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
    },
    inviteUrl: "http://localhost:3000/en/workflow-share/token_1",
  })),
  revokeShare: vi.fn(async () => ({
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
  })),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/hooks/use-workflow-shares", () => ({
  useWorkflowShares: () => ({
    isLoading: false,
    data: {
      shares: [
        {
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
      ],
      invitations: [
        {
          id: "inv_1",
          organizationId: "org_1",
          workflowId: "wf_1",
          email: "mangaohua@gmail.com",
          accessRole: "runner",
          token: "token_1",
          status: "pending",
          invitedByUserId: "owner_1",
          acceptedByUserId: null,
          expiresAt: "2026-02-22T00:00:00.000Z",
          acceptedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      ],
    },
  }),
  useCreateWorkflowShareInvitation: () => ({
    mutateAsync: mocks.createInvite,
    isPending: false,
  }),
  useRevokeWorkflowShare: () => ({
    mutateAsync: mocks.revokeShare,
    isPending: false,
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("WorkflowShareDialog", () => {
  beforeEach(() => {
    mocks.createInvite.mockClear();
    mocks.revokeShare.mockClear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("creates invite and revokes active share", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowShareDialog
          open
          onOpenChange={() => {}}
          locale="en"
          orgId="org_1"
          workflowId="wf_1"
          workflowName="Flow A"
        />
      </NextIntlClientProvider>
    );

    await user.type(screen.getByLabelText(messages.workflows.share.emailLabel), "mangaohua@gmail.com");
    await user.click(screen.getByRole("button", { name: messages.workflows.share.createAction }));

    await waitFor(() => expect(mocks.createInvite).toHaveBeenCalledTimes(1));
    expect(mocks.createInvite).toHaveBeenCalledWith({ email: "mangaohua@gmail.com" });

    await user.click(screen.getByRole("button", { name: messages.workflows.share.revoke }));
    await waitFor(() => expect(mocks.revokeShare).toHaveBeenCalledWith({ shareId: "share_1" }));
  });
});
