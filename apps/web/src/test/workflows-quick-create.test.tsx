import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import WorkflowsPage from "../app/[locale]/(app)/workflows/page";

const mocks = vi.hoisted(() => {
  return {
    push: vi.fn(),
    createWorkflow: vi.fn(async (_input: unknown) => ({ workflow: { id: "wf_1" } })),
  };
});

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ push: mocks.push }),
    useParams: () => ({ locale: "en" }),
  };
});

vi.mock("../lib/hooks/use-active-org-id", () => ({
  useActiveOrgId: () => "org_1",
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({ isLoading: false, data: { session: { token: "tok", expiresAt: 1 } } }),
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => ({ data: { settings: {} }, isError: false, refetch: vi.fn() }),
}));

vi.mock("../lib/hooks/use-workflows", () => ({
  useCreateWorkflow: () => ({ isPending: false, mutateAsync: mocks.createWorkflow }),
  useWorkflows: () => ({ data: { workflows: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("../components/app/llm/llm-compact-config-field", () => ({
  LlmCompactConfigField: (props: { testId?: string }) => <div data-testid={props.testId ?? "llm-compact-config-field"} />,
}));

vi.mock("../lib/recents", () => ({
  addRecentWorkflowId: vi.fn(),
  getRecentWorkflowIds: () => [],
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Workflows quick create", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.createWorkflow.mockClear();
  });

  it("shows quick fields by default and keeps advanced builder hidden", () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByLabelText(messages.workflows.fields.workflowName)).toBeInTheDocument();
    expect(screen.getByLabelText(messages.workflows.quickInstructions)).toBeInTheDocument();
    expect(screen.getByTestId("workflow-default-llm-compact")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.workflows.customizeAdvanced })).toBeInTheDocument();
    expect(screen.queryByText(messages.workflows.addAgentNode)).not.toBeInTheDocument();
    expect(screen.queryByText("Create and define your workflow first. Advanced access is available from More actions.")).not.toBeInTheDocument();
  });

  it("does not render a persistent open-by-id card", () => {
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    expect(screen.queryByText(messages.nav.openById)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.workflows.actions.more })).toBeInTheDocument();
  });

  it("empty-state create action focuses builder input and shows pulse feedback", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.workflows.empty.createActionLabel }));
    const workflowNameInput = screen.getByLabelText(messages.workflows.fields.workflowName);
    await waitFor(() => expect(workflowNameInput).toHaveFocus());
    expect(screen.getByTestId("workflow-builder-panel")).toHaveAttribute("data-pulse", "on");
  });

  it("template click prefills builder without creating immediately", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    const templateButtons = screen.getAllByRole("button", { name: messages.workflows.templates.useTemplate });
    await user.click(templateButtons[1]!);

    const workflowNameInput = screen.getByLabelText(messages.workflows.fields.workflowName) as HTMLInputElement;
    expect(workflowNameInput.value).toBe("Intake normalization");
    expect(mocks.createWorkflow).not.toHaveBeenCalled();
  });

  it("create success routes to graph editor", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.common.create }));
    await waitFor(() => expect(mocks.createWorkflow).toHaveBeenCalledTimes(1));
    const payload = mocks.createWorkflow.mock.calls.at(0)?.[0] as any;
    expect(payload?.dsl?.trigger?.type).toBe("trigger.manual");
    expect(payload?.dsl?.nodes?.[0]?.config?.engine?.id).toBe("gateway.codex.v2");
    expect(payload?.dsl?.nodes?.[0]?.config?.engine?.model).toBe("gpt-5.3-codex");
    expect(payload?.dsl?.nodes?.[0]?.config?.llm).toBeUndefined();
    expect(mocks.push).toHaveBeenCalledWith("/en/workflows/wf_1/graph?source=create");
  });

  it("supports cron trigger in quick create", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByRole("button", { name: messages.workflows.trigger.cron }));
    const cronInput = screen.getByLabelText(messages.workflows.trigger.cronExpr);
    await user.clear(cronInput);
    await user.type(cronInput, "0 * * * *");

    await user.click(screen.getByRole("button", { name: messages.common.create }));
    await waitFor(() => expect(mocks.createWorkflow).toHaveBeenCalledTimes(1));

    const payload = mocks.createWorkflow.mock.calls.at(0)?.[0] as any;
    expect(payload?.dsl?.trigger).toEqual({ type: "trigger.cron", config: { cron: "0 * * * *" } });
  });

  it("disabled create shows a specific reason", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <WorkflowsPage />
      </NextIntlClientProvider>
    );

    const workflowNameInput = screen.getByLabelText(messages.workflows.fields.workflowName);
    await user.clear(workflowNameInput);

    expect(screen.getByRole("button", { name: messages.common.create })).toBeDisabled();
    expect(screen.getByText(messages.workflows.createDisabledReasons.workflowName)).toBeInTheDocument();
  });
});
