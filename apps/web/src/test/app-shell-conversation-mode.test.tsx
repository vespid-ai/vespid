import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { DensityProvider } from "../lib/hooks/use-density";
import { AppShell } from "../components/app/app-shell";

const routeState = vi.hoisted(() => ({ pathname: "/en/conversations" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => routeState.pathname,
}));

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
              <div>layout-child</div>
            </AppShell>
          </QueryClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

describe("AppShell conversation mode", () => {
  beforeEach(() => {
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
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })
    );
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses conversation shell mode and suppresses onboarding strip on conversation routes", async () => {
    const messages = readMessages("en");
    routeState.pathname = "/en/conversations";
    renderShell();

    await waitFor(() => {
      const root = document.querySelector('[data-shell-mode="conversation"]');
      expect(root).toBeTruthy();
    });

    expect(screen.queryByText(messages.onboarding.title)).not.toBeInTheDocument();
  });

  it("keeps default shell mode on non-conversation routes", async () => {
    const messages = readMessages("en");
    routeState.pathname = "/en/workflows";
    renderShell();

    await waitFor(() => {
      const root = document.querySelector('[data-shell-mode="default"]');
      expect(root).toBeTruthy();
    });

    expect(await screen.findByText(messages.onboarding.title)).toBeInTheDocument();
  });

  it("uses wide shell width for workflow deep routes", async () => {
    routeState.pathname = "/en/workflows/wf_1/graph";
    const first = renderShell();

    await waitFor(() => {
      const root = document.querySelector('[data-shell-width="wide"]');
      expect(root).toBeTruthy();
    });
    first.unmount();

    routeState.pathname = "/en/workflows/wf_1/runs/run_1";
    renderShell();

    await waitFor(() => {
      const root = document.querySelector('[data-shell-width="wide"]');
      expect(root).toBeTruthy();
    });
  });

  it("uses wide shell width for list and other app routes", async () => {
    routeState.pathname = "/en/workflows";
    const first = renderShell();

    await waitFor(() => {
      const root = document.querySelector('[data-shell-width="wide"]');
      expect(root).toBeTruthy();
    });
    first.unmount();

    routeState.pathname = "/en/conversations";
    const second = renderShell();
    await waitFor(() => {
      const root = document.querySelector('[data-shell-width="wide"]');
      expect(root).toBeTruthy();
    });
    second.unmount();

    routeState.pathname = "/en/models";
    renderShell();
    await waitFor(() => {
      const root = document.querySelector('[data-shell-width="wide"]');
      expect(root).toBeTruthy();
    });
  });
});
