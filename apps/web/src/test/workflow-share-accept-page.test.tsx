import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import WorkflowShareAcceptPage from "../app/[locale]/(org)/workflow-share/[token]/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  acceptMutate: vi.fn(),
  session: { isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({
    locale: "en",
    token: encodeURIComponent("org_1.wf_1.token_1"),
  }),
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => mocks.session,
}));

vi.mock("../lib/hooks/use-workflow-shares", () => ({
  useAcceptWorkflowShareInvitation: () => ({
    mutateAsync: mocks.acceptMutate,
    isPending: false,
    data: null,
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("WorkflowShareAcceptPage", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.acceptMutate.mockReset();
    mocks.session = { isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } };
  });

  it("accepts invitation and redirects to shared workflow page", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.acceptMutate.mockResolvedValue({
      share: { id: "share_1" },
      invitation: {},
      workflow: { id: "wf_1", name: "Flow A", status: "published" },
    });

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowShareAcceptPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.workflows.share.accept.acceptAction }));
    await waitFor(() => expect(mocks.acceptMutate).toHaveBeenCalledWith({ token: "org_1.wf_1.token_1" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/en/shared-workflows/share_1"));
  });

  it("shows email mismatch message when acceptance fails", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    mocks.acceptMutate.mockRejectedValue({
      payload: { code: "WORKFLOW_SHARE_INVITATION_EMAIL_MISMATCH" },
    });

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowShareAcceptPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.workflows.share.accept.acceptAction }));
    await waitFor(() =>
      expect(screen.getByText(messages.workflows.share.accept.errors.emailMismatch)).toBeInTheDocument()
    );
  });
});
