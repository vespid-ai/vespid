import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

function readMessages(locale: "en" | "zh-CN") {
  const base = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(fs.readFileSync(base, "utf8")) as any;
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

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children and includes the mobile shell container", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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

    // The shell should not mount children twice (mobile + desktop).
    const nodes = await screen.findAllByText("child-content");
    expect(nodes).toHaveLength(1);
    expect(screen.queryByText("Session expired or access denied")).not.toBeInTheDocument();
    expect(screen.queryByText(/optimized for desktop/i)).not.toBeInTheDocument();
  });
});
