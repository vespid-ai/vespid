import { describe, expect, it, beforeEach } from "vitest";
import { clearActiveOrgId, getActiveOrgId, setActiveOrgId, subscribeActiveOrg } from "../lib/org-context";

describe("org-context", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearActiveOrgId();
  });

  it("persists active org id and notifies subscribers", () => {
    const events: Array<string | null> = [];
    const unsub = subscribeActiveOrg((next) => events.push(next));

    setActiveOrgId("org-123");
    expect(getActiveOrgId()).toBe("org-123");
    expect(events).toEqual(["org-123"]);

    clearActiveOrgId();
    expect(getActiveOrgId()).toBe(null);
    expect(events).toEqual(["org-123", null]);

    unsub();
  });
});
