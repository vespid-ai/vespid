"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LayoutGrid,
  LogOut,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "../../lib/hooks/use-session";
import {
  clearActiveOrgId,
  getActiveOrgId,
  getKnownOrgIds,
  setActiveOrgId,
  subscribeActiveOrg,
} from "../../lib/org-context";
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
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { CommandPalette } from "./command-palette";
import { apiFetch } from "../../lib/api";
import { ThemeToggle } from "./theme-toggle";
import { DensityToggle } from "./density-toggle";
import { useDensity } from "../../lib/hooks/use-density";

type NavItem = {
  href: (locale: string) => string;
  labelKey: string;
  icon: ReactNode;
};

const SIDEBAR_COLLAPSED_KEY = "vespid.ui.sidebarCollapsed";

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useMemo(() => getLocaleFromPathname(pathname ?? "/en"), [pathname]);

  const session = useSession();
  const { density } = useDensity();

  const [paletteOpen, setPaletteOpen] = useState(false);

  const [activeOrgId, setActiveOrgIdState] = useState<string>("");
  const [knownOrgIds, setKnownOrgIds] = useState<string[]>([]);
  const [draftOrgId, setDraftOrgId] = useState<string>("");

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const current = getActiveOrgId();
    setActiveOrgIdState(current ?? "");
    setKnownOrgIds(getKnownOrgIds());
    setDraftOrgId(current ?? "");

    const rawCollapsed = window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY);
    setSidebarCollapsed(rawCollapsed === "1");

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

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST" });
    router.refresh();
  }

  const userEmail = session.data?.user?.email;
  const userInitial = (userEmail?.trim()?.[0] ?? "U").toUpperCase();

  return (
    <div className="min-h-dvh group" data-density={density}>
      <CommandPalette
        locale={locale}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[
          { title: t("nav.workflows"), href: `/${locale}/workflows`, icon: LayoutGrid },
          { title: t("nav.secrets"), href: `/${locale}/secrets`, icon: KeyRound },
          { title: t("nav.agents"), href: `/${locale}/agents`, icon: Rocket },
          { title: t("nav.auth"), href: `/${locale}/auth`, icon: ShieldCheck },
          { title: t("nav.org"), href: `/${locale}/org`, icon: Users },
        ]}
      />

      <div
        className={cn(
          "mx-auto hidden min-h-dvh max-w-7xl gap-4 px-4 py-4 md:grid",
          sidebarCollapsed ? "grid-cols-[84px_1fr]" : "grid-cols-[288px_1fr]"
        )}
      >
        <aside className="sticky top-4 h-[calc(100dvh-2rem)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-panel/55 shadow-panel backdrop-blur">
          <div className={cn("flex items-center gap-2 px-3 py-3", sidebarCollapsed ? "justify-center" : "px-4")}
          >
            <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-border bg-panelElev/70">
              <Braces className="h-4 w-4" />
            </div>
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <div className="truncate font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("app.name")}</div>
                <div className="truncate text-xs text-muted">{t("app.tagline")}</div>
              </div>
            ) : null}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("ml-auto h-9 w-9 border border-border bg-panel/40", sidebarCollapsed ? "ml-0" : "")}
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          <nav className={cn("px-2", sidebarCollapsed ? "px-2" : "px-2")}
          >
            {nav.map((item) => {
              const href = item.href(locale);
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                    "transition-colors",
                    active
                      ? "bg-panelElev/70 text-text shadow-sm"
                      : "text-muted hover:bg-panel/70 hover:text-text",
                    sidebarCollapsed ? "justify-center px-2" : ""
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-accent" />
                  ) : null}
                  {item.icon}
                  {!sidebarCollapsed ? <span>{t(item.labelKey as any)}</span> : null}
                </Link>
              );
            })}
          </nav>

          {!sidebarCollapsed ? (
            <div className="mt-4 px-4">
              <Separator />
              <div className="mt-4 text-xs font-medium text-muted">{t("org.active")}</div>
              <div className="mt-2 break-all text-xs text-text">
                {activeOrgId ? activeOrgId : <span className="text-muted">{t("org.noActive")}</span>}
              </div>
            </div>
          ) : null}

          <div className="mt-auto px-4 pb-4 pt-6">
            <Separator />
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>dev</span>
              <a
                className="underline-offset-2 hover:underline"
                href="https://github.com/vespid-ai/vespid"
                target="_blank"
                rel="noreferrer"
              >
                docs
              </a>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-4 z-10 mb-4 overflow-hidden rounded-[var(--radius-md)] border border-border bg-panel/55 shadow-panel backdrop-blur">
            <div className="flex items-center justify-between gap-4 px-4 py-3 group-data-[density=compact]:py-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setPaletteOpen(true)}
                >
                  <Search className="h-4 w-4" />
                  Search
                  <span className="ml-2 hidden items-center gap-1 text-xs text-muted lg:inline-flex">
                    <kbd className="rounded border border-border bg-panel/60 px-1.5 py-0.5">Cmd</kbd>
                    <kbd className="rounded border border-border bg-panel/60 px-1.5 py-0.5">K</kbd>
                  </span>
                </Button>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Users className="h-4 w-4" />
                      {activeOrgId ? `Org ${shortId(activeOrgId)}` : t("org.noActive")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[420px]">
                    <div className="text-xs font-medium text-muted">{t("org.active")}</div>
                    <div className="mt-2 grid gap-2">
                      <select
                        value={activeOrgId}
                        onChange={(e) => applyOrgId(e.target.value)}
                        className="h-9 w-full rounded-[var(--radius-sm)] border border-border bg-panel/60 px-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
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
                        className="h-9 w-full rounded-[var(--radius-sm)] border border-border bg-panel/60 px-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
                      />
                      <div className="flex justify-end">
                        <Button variant="accent" onClick={() => applyOrgId(draftOrgId)}>
                          {t("org.set")}
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center gap-2">
                <DensityToggle />
                <ThemeToggle />

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
                      <Avatar className="h-6 w-6">
                        <AvatarFallback>{userInitial}</AvatarFallback>
                      </Avatar>
                      <span className="hidden max-w-56 truncate sm:inline">{userEmail ?? t("common.notLoggedIn")}</span>
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

      <div className="mx-auto block max-w-7xl px-4 pb-6 md:hidden">
        <Card className="p-4 text-sm text-muted">
          This UI is optimized for desktop while the product is early. Mobile support will be added as workflows mature.
        </Card>
      </div>
    </div>
  );
}
