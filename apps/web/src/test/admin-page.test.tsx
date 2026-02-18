import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import AdminPage from "../app/[locale]/(app)/admin/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  isSystemAdmin: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useParams: () => ({ locale: "en" }),
}));

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({
    isLoading: false,
    data: { session: { token: "tok", expiresAt: Date.now() + 60_000 }, user: { email: "ops@vespid.ai" } },
  }),
}));

vi.mock("../lib/hooks/use-me", () => ({
  useMe: () => ({
    isLoading: false,
    data: {
      user: { id: "u_1", email: "ops@vespid.ai" },
      account: { isSystemAdmin: mocks.isSystemAdmin },
      orgPolicy: { canManageOrganizations: true, maxOrganizations: 5, currentOrganizations: 1 },
      orgs: [{ id: "org_1", name: "Main Org", roleKey: "owner" }],
      defaultOrgId: "org_1",
    },
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={readMessages("en")}>
      <QueryClientProvider client={client}>
        <AdminPage />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("Admin page access", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.isSystemAdmin = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ settings: [], systemAdmins: [], providers: [], events: [], policy: {}, incidents: {}, services: [], metrics: {}, logs: {}, tickets: [] }), { status: 200, headers: { "content-type": "application/json" } }))
    );
  });

  it("redirects non-admin users to conversations", async () => {
    renderPage();
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/en/conversations");
    });
  });

  it("renders admin tabs for system administrators", async () => {
    mocks.isSystemAdmin = true;
    const messages = readMessages("en");
    renderPage();

    await screen.findByText(messages.admin.title);
    expect(screen.getByRole("tab", { name: messages.admin.tabs.governance })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.admin.tabs.risk })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.admin.tabs.observability })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: messages.admin.tabs.tickets })).toBeInTheDocument();
  });
});
