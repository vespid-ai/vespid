import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelChipPicker } from "../components/app/llm/model-chip-picker";

vi.mock("../components/app/model-picker/model-picker-dialog", () => ({
  ModelPickerDialog: (props: { open: boolean; onOpenChange: (open: boolean) => void; onChange: (next: string) => void }) =>
    props.open ? (
      <div data-testid="mock-model-picker-dialog">
        <button
          type="button"
          onClick={() => {
            props.onChange("gpt-5.3-codex");
            props.onOpenChange(false);
          }}
        >
          pick-model
        </button>
      </div>
    ) : null,
}));

describe("ModelChipPicker", () => {
  it("opens picker and applies selected model", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ModelChipPicker
        value=""
        onChange={onChange}
        placeholder="Select model"
        ariaLabel="Choose model"
        testId="model-chip"
      />
    );

    await user.click(screen.getByTestId("model-chip"));
    expect(screen.getByTestId("mock-model-picker-dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pick-model" }));
    expect(onChange).toHaveBeenCalledWith("gpt-5.3-codex");
  });

  it("supports clear action when enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ModelChipPicker
        value="gpt-5.3-codex"
        onChange={onChange}
        placeholder="Select model"
        ariaLabel="Choose model"
        allowClear
        clearLabel="Clear"
        testId="model-chip"
      />
    );

    await user.click(screen.getByTestId("model-chip-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
