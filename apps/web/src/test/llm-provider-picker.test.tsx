import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ProviderPicker, type ProviderPickerItem } from "../components/app/llm/provider-picker";

const labels = {
  title: "Choose provider",
  connected: "Connected",
  recommended: "Recommended",
  all: "All providers",
  searchPlaceholder: "Search provider...",
  noResults: "No matching providers.",
  badgeConnected: "Connected",
  badgeRecommended: "Recommended",
  badgeOauth: "OAuth",
};

const items: ProviderPickerItem[] = [
  { id: "openai", label: "OpenAI", connected: true, recommended: true, oauth: false },
  { id: "anthropic", label: "Anthropic", connected: false, recommended: true, oauth: false },
  { id: "custom", label: "Custom", connected: false, recommended: false, oauth: false },
];

describe("ProviderPicker", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to recommended filter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProviderPicker value="openai" items={items} onChange={onChange} labels={labels} />);

    await user.click(screen.getByRole("button", { name: "Choose provider" }));
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });

  it("can switch to all providers and search", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProviderPicker value="openai" items={items} onChange={onChange} labels={labels} />);

    await user.click(screen.getByRole("button", { name: "Choose provider" }));
    await user.click(screen.getByRole("button", { name: "All providers" }));
    expect(screen.getByText("Custom")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search provider..."), "anth");
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });

  it("supports keyboard selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProviderPicker value="openai" items={items} onChange={onChange} labels={labels} />);

    await user.click(screen.getByRole("button", { name: "Choose provider" }));
    await user.click(screen.getByRole("button", { name: "All providers" }));
    await user.click(screen.getByPlaceholderText("Search provider..."));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalled();
  });

  it("reflects controlled value updates", async () => {
    function ControlledExample() {
      const [value, setValue] = useState<"openai" | "anthropic">("openai");
      return (
        <div>
          <button type="button" onClick={() => setValue("anthropic")}>
            set-anthropic
          </button>
          <ProviderPicker value={value} items={items} onChange={(next) => setValue(next as "openai" | "anthropic")} labels={labels} />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<ControlledExample />);
    expect(screen.getByRole("button", { name: "Choose provider" })).toHaveTextContent("OpenAI");
    await user.click(screen.getByRole("button", { name: "set-anthropic" }));
    expect(screen.getByRole("button", { name: "Choose provider" })).toHaveTextContent("Anthropic");
  });
});
