import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { LlmCompactConfigField } from "../components/app/llm/llm-compact-config-field";
import type { LlmConfigValue } from "../components/app/llm/llm-config-field";

const llmConfigFieldMock = vi.hoisted(() => vi.fn());

vi.mock("../components/app/llm/llm-config-field", () => ({
  LlmConfigField: (props: unknown) => {
    llmConfigFieldMock(props);
    return <div data-testid="llm-config-field-inner" />;
  },
}));

vi.mock("../components/app/llm/model-chip-picker", () => ({
  ModelChipPicker: (props: {
    onChange: (next: string) => void;
    value: string;
    testId?: string;
  }) => (
    <div>
      <button type="button" data-testid={props.testId ?? "mock-model-chip"} onClick={() => props.onChange("gpt-5-codex")}>
        {props.value || "empty"}
      </button>
    </div>
  ),
}));

function readMessages() {
  const filePath = path.join(process.cwd(), "messages", "en.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function renderWithIntl(ui: ReactNode) {
  const messages = readMessages();
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("LlmCompactConfigField", () => {
  it("updates model via compact chip and keeps provider/secret unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value: LlmConfigValue = { providerId: "openai", modelId: "gpt-5.3-codex", secretId: null };

    renderWithIntl(
      <LlmCompactConfigField
        orgId="org_1"
        mode="primary"
        value={value}
        onChange={onChange}
        advancedSectionId="test-advanced"
        testId="llm-compact"
      />
    );

    await user.click(screen.getByTestId("llm-compact-chip"));
    expect(onChange).toHaveBeenCalledWith({ providerId: "openai", modelId: "gpt-5-codex", secretId: null });
  });

  it("shows advanced field only after expand and displays oauth warning when secret missing", async () => {
    const user = userEvent.setup();
    llmConfigFieldMock.mockClear();

    renderWithIntl(
      <LlmCompactConfigField
        orgId="org_1"
        mode="workflowAgentRun"
        value={{ providerId: "google-vertex", modelId: "gemini-2.5-pro", secretId: null }}
        onChange={() => {}}
        advancedSectionId="test-advanced-2"
        testId="llm-compact-2"
      />
    );

    expect(screen.queryByTestId("llm-config-field-inner")).not.toBeInTheDocument();
    expect(screen.getByText("Selected provider requires a connected account.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByTestId("llm-config-field-inner")).toBeInTheDocument();
    expect(llmConfigFieldMock).toHaveBeenCalled();
  });
});
