import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveOrgId: vi.fn(() => "bad-org-id"),
  setActiveOrgId: vi.fn(),
  clearActiveOrgId: vi.fn(),
}));

vi.mock("../lib/org-context", () => ({
  getActiveOrgId: mocks.getActiveOrgId,
  setActiveOrgId: mocks.setActiveOrgId,
  clearActiveOrgId: mocks.clearActiveOrgId,
}));

describe("api org context recovery", () => {
  beforeEach(() => {
    mocks.getActiveOrgId.mockReset();
    mocks.getActiveOrgId.mockReturnValue("bad-org-id");
    mocks.setActiveOrgId.mockReset();
    mocks.clearActiveOrgId.mockReset();
  });

  it("recovers org context via /v1/me and retries once", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: "INVALID_ORG_CONTEXT", message: "X-Org-Id must be a valid UUID" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ defaultOrgId: "org_recovered" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );

    const { apiFetchJson } = await import("../lib/api");
    const out = await apiFetchJson<{ sessions: unknown[] }>("/v1/orgs/org_recovered/sessions?limit=1", { method: "GET" }, { orgScoped: true });

    expect(out.sessions).toEqual([]);
    expect(mocks.setActiveOrgId).toHaveBeenCalledWith("org_recovered");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
