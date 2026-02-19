import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { SessionModelChip } from "../components/app/llm/session-model-chip";

const modelChipPickerMock = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("../components/app/llm/model-chip-picker", () => ({
  ModelChipPicker: (props: Record<string, unknown> & { onChange: (next: string) => void }) => {
    modelChipPickerMock.props = props;
    return (
      <button type="button" data-testid="mock-session-model-chip" onClick={() => props.onChange("claude-sonnet-4-20250514")}>
        pick-claude
      </button>
    );
  },
}));

describe("SessionModelChip", () => {
  it("allows cross-provider model selection within allowed providers", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf8")) as Record<string, unknown>;

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SessionModelChip
          value={{ providerId: "openai-codex", modelId: "gpt-5-codex" }}
          allowedProviders={["openai-codex", "anthropic", "opencode"]}
          onChange={onChange}
        />
      </NextIntlClientProvider>
    );

    await user.click(screen.getByTestId("mock-session-model-chip"));
    expect(onChange).toHaveBeenCalledWith({ providerId: "anthropic", modelId: "claude-sonnet-4-20250514" });
    expect(modelChipPickerMock.props?.providerFilter).toBeUndefined();
    expect(modelChipPickerMock.props?.allowedProviders).toEqual(["openai-codex", "anthropic", "opencode"]);
  });
});

