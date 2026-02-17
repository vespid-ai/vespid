"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  Monitor,
  Moon,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Separator } from "../ui/separator";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "../ui/sheet";
import { CommandPalette } from "./command-palette";
import { apiFetch, apiFetchJson, getApiBase } from "../../lib/api";
import { useDensity } from "../../lib/hooks/use-density";
import { useMounted } from "../../lib/hooks/use-mounted";
import { getApiReachability, subscribeApiReachability } from "../../lib/api-reachability";
import { Badge } from "../ui/badge";

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
  const queryClient = useQueryClient();

  const session = useSession();
  const { density, setDensity } = useDensity();
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();

  const [reachability, setReachability] = useState(() => getApiReachability());

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [activeOrgId, setActiveOrgIdState] = useState<string>("");
  const [knownOrgIds, setKnownOrgIds] = useState<string[]>([]);
  const [draftOrgId, setDraftOrgId] = useState<string>("");
  const [orgSummaries, setOrgSummaries] = useState<Array<{ id: string; name: string; roleKey: string }>>([]);
  const [hasStarterResource, setHasStarterResource] = useState(false);

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

  useEffect(() => {
    if (!session.data?.session) {
      setOrgSummaries([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetchJson<{
          user: { id: string; email: string };
          orgs: Array<{ id: string; name: string; roleKey: string }>;
          defaultOrgId: string | null;
        }>("/v1/me");
        if (cancelled) return;
        setOrgSummaries(Array.isArray(me.orgs) ? me.orgs : []);
        const ids = Array.isArray(me.orgs) ? me.orgs.map((o) => o.id).filter(Boolean) : [];
        setKnownOrgIds((prev) => {
          const merged = [...new Set([...ids, ...prev])];
          return merged;
        });
        const current = getActiveOrgId();
        if (!current && me.defaultOrgId) {
          setActiveOrgId(me.defaultOrgId);
        }
      } catch {
        // /v1/me is best-effort; org can still be set manually.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.data?.session]);

  useEffect(() => {
    if (!session.data?.session || !activeOrgId) {
      setHasStarterResource(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const [sessionsRes, workflowsRes] = await Promise.allSettled([
        apiFetchJson<{ sessions: Array<{ id: string }> }>(
          `/v1/orgs/${activeOrgId}/sessions?limit=1`,
          { method: "GET" },
          { orgScoped: true }
        ),
        apiFetchJson<{ workflows: Array<{ id: string }> }>(
          `/v1/orgs/${activeOrgId}/workflows?limit=1`,
          { method: "GET" },
          { orgScoped: true }
        ),
      ]);

      if (cancelled) return;

      const sessionCount = sessionsRes.status === "fulfilled" ? (sessionsRes.value.sessions ?? []).length : 0;
      const workflowCount = workflowsRes.status === "fulfilled" ? (workflowsRes.value.workflows ?? []).length : 0;

      setHasStarterResource(sessionCount > 0 || workflowCount > 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [session.data?.session, activeOrgId]);

  useEffect(() => {
    setReachability(getApiReachability());
    return subscribeApiReachability((next) => setReachability(next));
  }, []);

  const nav: NavItem[] = useMemo(
    () => [
      { href: (l) => `/${l}/conversations`, labelKey: "nav.sessions", icon: <MessageCircle className="h-4 w-4" /> },
      { href: (l) => `/${l}/workflows`, labelKey: "nav.workflows", icon: <LayoutGrid className="h-4 w-4" /> },
      { href: (l) => `/${l}/channels`, labelKey: "nav.channels", icon: <MessageSquare className="h-4 w-4" /> },
      { href: (l) => `/${l}/billing`, labelKey: "nav.billing", icon: <CreditCard className="h-4 w-4" /> },
      { href: (l) => `/${l}/agents`, labelKey: "nav.agents", icon: <Rocket className="h-4 w-4" /> },
      { href: (l) => `/${l}/toolsets`, labelKey: "nav.toolsets", icon: <Braces className="h-4 w-4" /> },
    ],
    []
  );

  const orgLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgSummaries) {
      map.set(org.id, org.name);
    }
    return map;
  }, [orgSummaries]);

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
    try {
      await apiFetch("/v1/auth/logout", { method: "POST" });
    } catch {
      // Best effort: continue local sign-out UX even if network is unstable.
    }
    clearActiveOrgId();
    setOrgSummaries([]);
    setKnownOrgIds([]);
    setDraftOrgId("");
    setHasStarterResource(false);
    queryClient.setQueryData(["session"], null);
    router.push(`/${locale}/auth?loggedOut=1`);
  }

  const userEmail = session.data?.user?.email;
  const userInitial = (userEmail?.trim()?.[0] ?? "U").toUpperCase();
  const hasSession = Boolean(session.data?.session);
  const visibleActiveOrgId = hasSession ? activeOrgId : "";
  const visibleKnownOrgIds = hasSession ? knownOrgIds : [];
  const apiUnreachable =
    !hasSession &&
    typeof reachability.unreachableAt === "number" &&
    Date.now() - reachability.unreachableAt < 2 * 60_000;

  const themeLabel = mounted ? (theme ?? "system") : "system";
  const hasStarterRoute = useMemo(() => {
    const p = pathname ?? "";
    return /^\/[^/]+\/(conversations|workflows)\/[^/]+/.test(p);
  }, [pathname]);
  const onboardingVisible = mounted && hasSession && (!activeOrgId || !(hasStarterResource || hasStarterRoute));
  const showApiUnreachable = mounted && apiUnreachable;

  function SettingsDropdown({ iconOnly }: { iconOnly?: boolean }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={iconOnly ? "icon" : "sm"}
            className={iconOnly ? "" : "gap-2"}
            aria-label={t("settings.title")}
          >
            <Settings2 className="h-4 w-4" />
            {iconOnly ? null : t("settings.title")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <div className="px-2 py-1 text-xs font-medium text-muted">{t("settings.theme.title")}</div>
          <DropdownMenuItem onSelect={() => setTheme("light")}>
            <Sun className="h-4 w-4" />
            {t("settings.theme.light")}
            {themeLabel === "light" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme("dark")}>
            <Moon className="h-4 w-4" />
            {t("settings.theme.dark")}
            {themeLabel === "dark" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme("system")}>
            <Monitor className="h-4 w-4" />
            {t("settings.theme.system")}
            {themeLabel === "system" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-2 py-1 text-xs font-medium text-muted">{t("settings.density.title")}</div>
          <DropdownMenuItem onSelect={() => setDensity("comfortable")}>
            {t("settings.density.comfortable")}
            {density === "comfortable" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDensity("compact")}>
            {t("settings.density.compact")}
            {density === "compact" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-2 py-1 text-xs font-medium text-muted">{t("settings.locale.title")}</div>
          <DropdownMenuItem onSelect={() => router.push(replaceLocaleInPathname(pathname ?? `/${locale}`, "en"))}>
            en
            {locale === "en" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push(replaceLocaleInPathname(pathname ?? `/${locale}`, "zh-CN"))}>
            zh-CN
            {locale === "zh-CN" ? <Check className="ml-auto h-4 w-4 text-muted" /> : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/models`}>{t("settings.modelConnections")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="https://github.com/vespid-ai/vespid" target="_blank" rel="noreferrer">
              {t("common.docs")}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function UserDropdown({ iconOnly }: { iconOnly?: boolean }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={iconOnly ? "icon" : "sm"}
            className={iconOnly ? "" : "gap-2"}
            aria-label={userEmail ?? t("common.notLoggedIn")}
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback>{userInitial}</AvatarFallback>
            </Avatar>
            {iconOnly ? null : <span className="hidden max-w-56 truncate sm:inline">{userEmail ?? t("common.notLoggedIn")}</span>}
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
    );
  }

  return (
    <div className="min-h-dvh group" data-density={density}>
      <CommandPalette
        locale={locale}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={[
          { title: t("nav.sessions"), href: `/${locale}/conversations`, icon: MessageCircle },
          { title: t("nav.workflows"), href: `/${locale}/workflows`, icon: LayoutGrid },
          { title: t("nav.channels"), href: `/${locale}/channels`, icon: MessageSquare },
          { title: t("nav.billing"), href: `/${locale}/billing`, icon: CreditCard },
          { title: t("nav.agents"), href: `/${locale}/agents`, icon: Rocket },
          { title: t("nav.toolsets"), href: `/${locale}/toolsets`, icon: Braces },
          { title: t("nav.auth"), href: `/${locale}/auth`, icon: ShieldCheck },
          { title: t("nav.org"), href: `/${locale}/org`, icon: Users },
        ]}
      />

      <div className="mx-auto min-h-dvh max-w-7xl px-3 py-3 md:px-4 md:py-4">
        <div
          className={cn(
            "min-h-dvh md:grid md:gap-4",
            sidebarCollapsed ? "md:grid-cols-[84px_1fr]" : "md:grid-cols-[288px_1fr]"
          )}
        >
          <aside
            className={cn(
              "hidden md:block sticky top-4 h-[calc(100dvh-2rem)] overflow-hidden rounded-[var(--radius-md)] border border-borderSubtle/70 bg-panel/84 shadow-elev1 backdrop-blur"
            )}
          >
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
              className={cn("ml-auto h-9 w-9 border border-borderSubtle bg-panel/35", sidebarCollapsed ? "ml-0" : "")}
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
                    "transition-[box-shadow,background-color,color,border-color] duration-200",
                    active
                      ? "bg-surface2/60 text-text shadow-elev1"
                      : "text-muted hover:bg-panel/55 hover:text-text hover:shadow-elev1",
                    sidebarCollapsed ? "justify-center px-2" : ""
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-gradient-to-b from-brand to-brand2" />
                  ) : null}
                  {item.icon}
                  {!sidebarCollapsed ? <span>{t(item.labelKey as any)}</span> : null}
                </Link>
              );
            })}
          </nav>

          {!sidebarCollapsed && hasSession ? (
            <div className="mt-4 px-4">
              <Separator />
              <div className="mt-4 text-xs font-medium text-muted">{t("org.active")}</div>
              <div className="mt-2 break-all text-xs text-text">
                {visibleActiveOrgId ? visibleActiveOrgId : <span className="text-muted">{t("org.noActive")}</span>}
              </div>
            </div>
          ) : null}

          <div className="mt-auto px-4 pb-4 pt-6" />
        </aside>

          <section className="min-w-0">
            <header
              className={cn(
                "sticky top-3 md:top-4 z-10 mb-3 md:mb-4 overflow-hidden rounded-[var(--radius-md)] border border-borderSubtle/70 bg-panel/84 shadow-elev1 backdrop-blur"
              )}
            >
              <div className="flex items-center justify-between gap-4 px-3 py-2 md:px-4 md:py-3 group-data-[density=compact]:py-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 md:hidden">
                    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                      <SheetTrigger asChild>
                        <Button variant="outline" size="icon" aria-label={t("common.toggle")}>
                          <Menu className="h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent
                        side="left"
                        className="p-4"
                        title={t("common.nav")}
                        description={t("commandPalette.description")}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-borderSubtle/60 bg-panel/45 shadow-elev1">
                              <Braces className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-[var(--font-display)] text-sm font-semibold tracking-tight">
                                {t("app.name")}
                              </div>
                              <div className="truncate text-xs text-muted">{t("app.tagline")}</div>
                            </div>
                          </div>
                          <SheetClose asChild>
                            <Button variant="outline" size="icon" aria-label={t("common.close")}>
                              <X className="h-4 w-4" />
                            </Button>
                          </SheetClose>
                        </div>

                        <nav className="mt-4 grid gap-1">
                          {nav.map((item) => {
                            const href = item.href(locale);
                            const active = isActive(href);
                            return (
                              <Link
                                key={href}
                                href={href}
                                onClick={() => setMobileNavOpen(false)}
                                className={cn(
                                  "group relative flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                                  "transition-[box-shadow,background-color,color,border-color] duration-200",
                                  active
                                    ? "bg-surface2/60 text-text shadow-elev1"
                                    : "text-muted hover:bg-panel/55 hover:text-text hover:shadow-elev1"
                                )}
                              >
                                {active ? (
                                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-gradient-to-b from-brand to-brand2" />
                                ) : null}
                                {item.icon}
                                <span>{t(item.labelKey as any)}</span>
                              </Link>
                            );
                          })}
                        </nav>

                        {hasSession ? (
                          <>
                            <div className="mt-4">
                              <Separator />
                            </div>

                            <div className="mt-4">
                              <div className="text-xs font-medium text-muted">{t("org.active")}</div>
                              <div className="mt-2 grid gap-2">
                                <Select
                                  value={visibleActiveOrgId || "__none__"}
                                  onValueChange={(value) => applyOrgId(value === "__none__" ? "" : value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">{t("org.noActive")}</SelectItem>
                                    {visibleKnownOrgIds.map((id) => (
                                      <SelectItem key={id} value={id}>
                                        {orgLabelById.get(id) ? `${orgLabelById.get(id)} (${shortId(id)})` : id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <input
                                  value={draftOrgId}
                                  onChange={(e) => setDraftOrgId(e.target.value)}
                                  placeholder={t("org.paste")}
                                  className="h-9 w-full rounded-[var(--radius-sm)] border border-borderSubtle/60 bg-panel/55 px-3 text-sm text-text shadow-elev1 outline-none placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
                                />
                                <div className="flex justify-end">
                                  <Button
                                    variant="accent"
                                    onClick={() => {
                                      applyOrgId(draftOrgId);
                                      setMobileNavOpen(false);
                                    }}
                                  >
                                    {t("org.set")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : null}

                        <div className="mt-4">
                          <Separator />
                        </div>

                        <div className="mt-4 grid gap-2">
                          <Button asChild variant="outline" onClick={() => setMobileNavOpen(false)}>
                            <Link href={`/${locale}/auth`}>{t("nav.auth")}</Link>
                          </Button>
                          <Button asChild variant="outline" onClick={() => setMobileNavOpen(false)}>
                            <Link href={`/${locale}/org`}>{t("nav.org")}</Link>
                          </Button>
                          <Button
                            variant="danger"
                            onClick={async () => {
                              await logout();
                              setMobileNavOpen(false);
                            }}
                          >
                            <LogOut className="h-4 w-4" />
                            {t("auth.logout")}
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>

                    <div className="font-[var(--font-display)] text-sm font-semibold tracking-tight">{t("app.name")}</div>
                  </div>

                  <div className="hidden md:flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 rounded-[var(--radius-md)]"
                      onClick={() => setPaletteOpen(true)}
                    >
                      <Search className="h-4 w-4" />
                      {t("common.search")}
                      <span className="ml-2 hidden items-center gap-1 text-xs text-muted lg:inline-flex">
                        <kbd className="rounded border border-borderSubtle bg-panel/60 px-1.5 py-0.5">Cmd</kbd>
                        <kbd className="rounded border border-borderSubtle bg-panel/60 px-1.5 py-0.5">K</kbd>
                      </span>
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 md:hidden">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("common.search")}
                      onClick={() => setPaletteOpen(true)}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                    <SettingsDropdown iconOnly />
                    <UserDropdown iconOnly />
                  </div>

                  <div className="hidden md:flex items-center gap-2">
                    <SettingsDropdown />
                    <UserDropdown />
                  </div>
                </div>
              </div>

              {showApiUnreachable ? (
                <div className="border-t border-borderSubtle bg-panel/40 px-3 md:px-4 py-2">
                  <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-start">
                    <Badge variant="warn" className="gap-1.5">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      {t("errors.apiUnreachable.title")}
                    </Badge>
                    <div className="min-w-0 flex-1 break-words text-muted">
                      {t("errors.apiUnreachable.description", { base: reachability.base || getApiBase() })}
                    </div>
                  </div>
                </div>
              ) : null}

              {onboardingVisible ? (
                <div className="border-t border-borderSubtle bg-panel/40 px-3 md:px-4 py-3">
                  <div className="grid gap-2">
                    <div className="text-sm font-medium text-text">{t("onboarding.title")}</div>
                    <div className="text-xs text-muted">{t("onboarding.subtitle")}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="ok">{t("onboarding.stepLogin")}</Badge>
                      <Badge variant={activeOrgId ? "ok" : "warn"}>{t("onboarding.stepOrg")}</Badge>
                      <Badge variant={hasStarterResource ? "ok" : "warn"}>{t("onboarding.stepFirstResource")}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!activeOrgId ? (
                        <Button size="sm" variant="accent" asChild>
                          <Link href={`/${locale}/org`}>{t("onboarding.goOrg")}</Link>
                        </Button>
                      ) : null}
                      {activeOrgId && !hasStarterResource ? (
                        <>
                          <Button size="sm" variant="accent" asChild>
                            <Link href={`/${locale}/conversations`}>{t("onboarding.goSession")}</Link>
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/${locale}/workflows`}>{t("onboarding.goWorkflow")}</Link>
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </header>

            <main className="min-w-0">
              <div className="animate-fade-in">{children}</div>
            </main>
          </section>
        </div>
      </div>
    </div>
  );
}
