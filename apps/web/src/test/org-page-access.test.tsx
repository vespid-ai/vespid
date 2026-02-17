import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import OrganizationPage from "../app/[locale]/(org)/org/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  canManageOrganizations: false,
  meData: {
    user: { id: "u_1", email: "user@example.com" },
    account: { tier: "free", isSystemAdmin: false },
    orgPolicy: { canManageOrganizations: false, maxOrganizations: 1, currentOrganizations: 1 },
    orgs: [{ id: "org_1", name: "Default Org", roleKey: "owner" }],
    defaultOrgId: "org_1",
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useParams: () => ({ locale: "en" }),
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({
    isLoading: false,
    data: { session: { token: "tok", expiresAt: Date.now() + 60_000 }, user: { email: "user@example.com" } },
  }),
}));

vi.mock("../lib/hooks/use-me", () => ({
  useMe: () => ({
    data: {
      ...mocks.meData,
      orgPolicy: { ...mocks.meData.orgPolicy, canManageOrganizations: mocks.canManageOrganizations },
    },
    refetch: vi.fn(),
  }),
}));

vi.mock("../lib/org-context", () => ({
  getActiveOrgId: () => "org_1",
  getKnownOrgIds: () => ["org_1"],
  setActiveOrgId: vi.fn(),
  subscribeActiveOrg: () => () => {},
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

describe("Org page access", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.canManageOrganizations = false;
    mocks.meData.orgPolicy.canManageOrganizations = false;
  });

  it("redirects free users without org management permissions", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={readMessages("en")}>
        <OrganizationPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/en/conversations");
    });
  });
});
