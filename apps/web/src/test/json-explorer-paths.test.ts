import { describe, expect, it } from "vitest";
import { __testOnly } from "../components/ui/json-explorer";

describe("JsonExplorer path formatting", () => {
  it("formats simple keys with dot notation", () => {
    expect(__testOnly.formatKeyPath("payload", "input")).toBe("payload.input");
  });

  it("formats non-identifier keys using bracket quotes", () => {
    expect(__testOnly.formatKeyPath("payload", "foo.bar")).toBe('payload["foo.bar"]');
  });

  it("formats array indices", () => {
    expect(__testOnly.formatIndexPath("items", 3)).toBe("items[3]");
  });
});

