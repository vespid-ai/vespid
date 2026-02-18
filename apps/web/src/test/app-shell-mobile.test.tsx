import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { DensityProvider } from "../lib/hooks/use-density";
import { AppShell } from "../components/app/app-shell";

vi.mock("next/navigation", () => {
  return {
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/en/workflows",
  };
});

vi.mock("../lib/hooks/use-session", () => ({
  useSession: () => ({
    isLoading: false,
    data: { session: { token: "tok", expiresAt: Date.now() + 60_000 }, user: { email: "ops@vespid.ai" } },
  }),
}));

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
}

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={readMessages("en")}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <DensityProvider>
          <QueryClientProvider client={client}>
            <AppShell>
              <div>child-content</div>
            </AppShell>
          </QueryClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

describe("AppShell mobile rendering", () => {
  beforeEach(() => {
    // next-themes expects matchMedia in the browser.
    (window as any).matchMedia =
      (window as any).matchMedia ||
      ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/me")) {
          return new Response(
            JSON.stringify({
              user: { id: "u_1", email: "ops@vespid.ai" },
              account: { isSystemAdmin: false },
              orgPolicy: { canManageOrganizations: true, maxOrganizations: 5, currentOrganizations: 0 },
              orgs: [],
              defaultOrgId: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/sessions") || url.includes("/workflows")) {
          return new Response(JSON.stringify({ sessions: [], workflows: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children and includes the mobile shell container", async () => {
    renderShell();

    // The shell should not mount children twice (mobile + desktop).
    const nodes = await screen.findAllByText("child-content");
    expect(nodes).toHaveLength(1);
    expect(screen.queryByText("Session expired or access denied")).not.toBeInTheDocument();
    expect(screen.queryByText(/optimized for desktop/i)).not.toBeInTheDocument();
  });

  it("keeps onboarding collapsed by default and persists expanded state", async () => {
    const user = userEvent.setup();
    const messages = readMessages("en");

    const view = renderShell();

    await screen.findByText(messages.onboarding.title);

    await user.click(screen.getByRole("button", { name: "Show" }));
    await screen.findByRole("link", { name: messages.onboarding.goOrg });
    expect(screen.queryByText("Only essential steps are shown here.")).not.toBeInTheDocument();

    view.unmount();
    renderShell();

    await screen.findByRole("link", { name: messages.onboarding.goOrg });
    expect(window.localStorage.getItem("vespid.ui.onboarding-collapsed")).toBe("0");
  });

  it("hides organization management entry for free users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/me")) {
          return new Response(
            JSON.stringify({
              user: { id: "u_1", email: "ops@vespid.ai" },
              account: { isSystemAdmin: false },
              orgPolicy: { canManageOrganizations: false, maxOrganizations: 1, currentOrganizations: 1 },
              orgs: [{ id: "org_default", name: "Default workspace", roleKey: "owner" }],
              defaultOrgId: "org_default",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const user = userEvent.setup();
    const messages = readMessages("en");
    renderShell();

    const userButtons = screen.getAllByRole("button", { name: "ops@vespid.ai" });
    await user.click(userButtons[userButtons.length - 1]!);
    expect(screen.queryByRole("menuitem", { name: messages.nav.org })).not.toBeInTheDocument();
  });

  it("shows admin entry for system administrators", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/me")) {
          return new Response(
            JSON.stringify({
              user: { id: "u_1", email: "ops@vespid.ai" },
              account: { isSystemAdmin: true },
              orgPolicy: { canManageOrganizations: true, maxOrganizations: 5, currentOrganizations: 1 },
              orgs: [{ id: "org_default", name: "Main Org", roleKey: "owner" }],
              defaultOrgId: "org_default",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );

    const messages = readMessages("en");
    renderShell();

    expect(await screen.findByRole("link", { name: messages.nav.admin })).toBeInTheDocument();
  });
});
