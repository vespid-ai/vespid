import { describe, expect, it } from "vitest";
import { groupEventsByAttempt } from "../lib/run-events";

describe("groupEventsByAttempt", () => {
  it("groups by attemptCount and sorts by createdAt", () => {
    const grouped = groupEventsByAttempt([
      { id: "e2", attemptCount: 2, createdAt: "2026-01-01T00:00:02Z" },
      { id: "e1", attemptCount: 1, createdAt: "2026-01-01T00:00:01Z" },
      { id: "e3", attemptCount: 2, createdAt: "2026-01-01T00:00:01Z" }
    ] as any);

    expect(grouped.map((g) => g.attempt)).toEqual([1, 2]);
    expect(grouped[1]?.events.map((e: any) => e.id)).toEqual(["e3", "e2"]);
  });
});
