"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Braces, KeyRound, LayoutGrid, LogOut, Rocket, Settings2, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "../../lib/hooks/use-session";
import { clearActiveOrgId, getActiveOrgId, getKnownOrgIds, setActiveOrgId, subscribeActiveOrg } from "../../lib/org-context";
import { cn } from "../../lib/cn";
import { getLocaleFromPathname, replaceLocaleInPathname } from "../../i18n/pathnames";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { CommandPalette } from "./command-palette";
import { apiFetch } from "../../lib/api";

type NavItem = {
  href: (locale: string) => string;
  labelKey: string;
  icon: ReactNode;
};

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useMemo(() => getLocaleFromPathname(pathname ?? "/en"), [pathname]);

  const session = useSession();

  const [activeOrgId, setActiveOrgIdState] = useState<string>("");
  const [knownOrgIds, setKnownOrgIds] = useState<string[]>([]);
  const [draftOrgId, setDraftOrgId] = useState<string>("");

  useEffect(() => {
    const current = getActiveOrgId();
    setActiveOrgIdState(current ?? "");
    setKnownOrgIds(getKnownOrgIds());
    setDraftOrgId(current ?? "");

    return subscribeActiveOrg((next) => {
      setActiveOrgIdState(next ?? "");
      setKnownOrgIds(getKnownOrgIds());
      setDraftOrgId(next ?? "");
    });
  }, []);

  const nav: NavItem[] = useMemo(
    () => [
      { href: (l) => `/${l}/workflows`, labelKey: "nav.workflows", icon: <LayoutGrid className="h-4 w-4" /> },
      { href: (l) => `/${l}/secrets`, labelKey: "nav.secrets", icon: <KeyRound className="h-4 w-4" /> },
      { href: (l) => `/${l}/agents`, labelKey: "nav.agents", icon: <Rocket className="h-4 w-4" /> },
    ],
    []
  );

  function isActive(href: string): boolean {
    return (pathname ?? "").startsWith(href);
  }

  function applyOrgId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      clearActiveOrgId();
      return;
    }
    setActiveOrgId(trimmed);
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="min-h-dvh">
      <CommandPalette
        locale={locale}
        items={[
          { title: t("nav.workflows"), href: `/${locale}/workflows`, icon: LayoutGrid },
          { title: t("nav.secrets"), href: `/${locale}/secrets`, icon: KeyRound },
          { title: t("nav.agents"), href: `/${locale}/agents`, icon: Rocket },
          { title: t("nav.auth"), href: `/${locale}/auth`, icon: ShieldCheck },
          { title: t("nav.org"), href: `/${locale}/org`, icon: Users },
        ]}
      />

      <div className="mx-auto hidden min-h-dvh max-w-7xl grid-cols-[260px_1fr] gap-4 px-4 py-4 md:grid">
        <aside className="sticky top-4 h-[calc(100dvh-2rem)] overflow-hidden rounded-lg border border-border bg-panel/60 shadow-panel backdrop-blur">
          <div className="flex items-center gap-2 px-4 py-4">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-panelElev/70">
              <Braces className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("app.name")}</div>
              <div className="truncate text-xs text-muted">{t("app.tagline")}</div>
            </div>
          </div>

          <nav className="px-2">
            {nav.map((item) => {
              const href = item.href(locale);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                    isActive(href)
                      ? "bg-panelElev text-text shadow-sm"
                      : "text-muted hover:bg-panel hover:text-text"
                  )}
                >
                  {item.icon}
                  {t(item.labelKey as any)}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 px-4">
            <Separator />
          </div>

          <div className="mt-4 px-4">
            <div className="text-xs font-medium text-muted">{t("org.active")}</div>
            <div className="mt-2 flex flex-col gap-2">
              <select
                value={activeOrgId}
                onChange={(e) => applyOrgId(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-panel/50 px-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
              >
                <option value="">{t("org.noActive")}</option>
                {knownOrgIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <input
                value={draftOrgId}
                onChange={(e) => setDraftOrgId(e.target.value)}
                placeholder={t("org.paste")}
                className="h-9 w-full rounded-md border border-border bg-panel/50 px-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
              />
              <Button variant="accent" onClick={() => applyOrgId(draftOrgId)}>
                {t("org.set")}
              </Button>
              {activeOrgId ? <div className="break-all text-[11px] text-muted">{activeOrgId}</div> : null}
            </div>
          </div>

          <div className="mt-auto px-4 pb-4 pt-6">
            <Separator />
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>dev</span>
              <a className="underline-offset-2 hover:underline" href="https://github.com/vespid-ai/vespid" target="_blank" rel="noreferrer">
                docs
              </a>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-4 z-10 mb-4 overflow-hidden rounded-lg border border-border bg-panel/55 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted">Cmd</div>
                <kbd className="rounded border border-border bg-panel/60 px-2 py-0.5 text-xs text-text">K</kbd>
                <div className="text-xs text-muted">to search</div>
              </div>

              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Settings2 className="h-4 w-4" />
                      {locale}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => router.push(replaceLocaleInPathname(pathname ?? `/${locale}`, "en"))}>en</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push(replaceLocaleInPathname(pathname ?? `/${locale}`, "zh-CN"))}>zh-CN</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Users className="h-4 w-4" />
                      {session.data?.user?.email ?? t("common.notLoggedIn")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/${locale}/auth`}>{t("nav.auth")}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/${locale}/org`}>{t("nav.org")}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={logout}>
                      <LogOut className="h-4 w-4" />
                      {t("auth.logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main className="min-w-0">
            <div className="animate-fade-in">{children}</div>
          </main>
        </section>
      </div>

      {/* Small-screen fallback */}
      <div className="mx-auto block max-w-7xl px-4 pb-6 md:hidden">
        <Card className="p-4 text-sm text-muted">
          This UI is optimized for desktop while the product is early. Mobile support will be added as workflows mature.
        </Card>
      </div>
    </div>
  );
}
