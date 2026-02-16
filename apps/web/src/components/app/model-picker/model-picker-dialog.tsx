"use client";

import { Command } from "cmdk";
import { Check, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { cn } from "../../../lib/cn";
import { curatedModels, inferProviderFromModelId, providerLabels, type LlmProviderId } from "../llm/model-catalog";

type ProviderGroupId = LlmProviderId | "other";

type PickerItem = {
  providerId: ProviderGroupId;
  modelId: string;
  name: string;
  recommended: boolean;
  isCustom?: boolean;
};

const DISABLED_STORAGE_KEY = "vespid.ui.models.disabled.v1";
const RECENT_STORAGE_KEY = "vespid.ui.models.recent.v1";
const PROVIDER_IDS = Object.keys(providerLabels) as LlmProviderId[];
const PROVIDER_GROUP_IDS: ProviderGroupId[] = [...PROVIDER_IDS, "other"];

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage quota/unavailable errors.
  }
}

function readDisabledMap(): Record<string, string[]> {
  const parsed = readJson<unknown>(DISABLED_STORAGE_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, string[]>;
}

function writeDisabledMap(next: Record<string, string[]>): void {
  writeJson(DISABLED_STORAGE_KEY, next);
}

function readRecents(): string[] {
  const parsed = readJson<unknown>(RECENT_STORAGE_KEY, []);
  return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === "string" && v.trim().length > 0) as string[]) : [];
}

function pushRecent(modelId: string): void {
  const trimmed = modelId.trim();
  if (!trimmed) return;
  const current = readRecents();
  const next = [trimmed, ...current.filter((x) => x !== trimmed)].slice(0, 20);
  writeJson(RECENT_STORAGE_KEY, next);
}

function normalizeProviderGroup(providerId: string | null): ProviderGroupId {
  if (providerId && (PROVIDER_IDS as string[]).includes(providerId)) return providerId as LlmProviderId;
  return "other";
}

function groupLabel(t: ReturnType<typeof useTranslations>, id: ProviderGroupId): string {
  if (id === "other") return t("models.otherProviders");
  return providerLabels[id];
}

export function ModelPickerDialog({
  open,
  onOpenChange,
  value,
  onChange,
  providerFilter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (next: string) => void;
  providerFilter?: LlmProviderId;
}) {
  const t = useTranslations();
  const [tab, setTab] = useState<"pick" | "manage">("pick");
  const [query, setQuery] = useState("");
  const [disabledMap, setDisabledMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setDisabledMap(readDisabledMap());
  }, [open]);

  const baseItems = useMemo<PickerItem[]>(() => {
    return curatedModels
      .filter((m) => (providerFilter ? m.providerId === providerFilter : true))
      .map((m) => ({
        providerId: m.providerId,
        modelId: m.modelId,
        name: m.name,
        recommended: Boolean(m.tags?.includes("recommended")),
      }));
  }, [providerFilter]);

  const recentItems = useMemo<PickerItem[]>(() => {
    const recent = readRecents();
    const byId = new Map<string, PickerItem>();

    for (const it of baseItems) {
      byId.set(it.modelId, it);
    }

    const out: PickerItem[] = [];
    for (const modelId of recent) {
      const known = byId.get(modelId);
      if (known) {
        out.push(known);
        continue;
      }
      const inferred = normalizeProviderGroup(inferProviderFromModelId(modelId));
      if (providerFilter && inferred !== providerFilter) {
        continue;
      }
      out.push({
        providerId: inferred,
        modelId,
        name: modelId,
        recommended: false,
        isCustom: true,
      });
    }
    return out;
    // baseItems already accounts for providerFilter
  }, [baseItems, providerFilter]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const disabled = disabledMap;

    const visible = baseItems.filter((it) => {
      const disabledForProvider = disabled[it.providerId] ?? [];
      if (disabledForProvider.includes(it.modelId)) return false;
      if (!q) return true;
      return (
        it.modelId.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        String(it.providerId).toLowerCase().includes(q)
      );
    });

    return visible;
  }, [baseItems, query, disabledMap]);

  const grouped = useMemo(() => {
    const groups = Object.fromEntries(PROVIDER_GROUP_IDS.map((id) => [id, [] as PickerItem[]])) as Record<ProviderGroupId, PickerItem[]>;
    for (const it of filteredItems) {
      groups[it.providerId].push(it);
    }
    return groups;
  }, [filteredItems]);

  const selectedLower = value.trim().toLowerCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setTab("pick");
          setQuery("");
        }
      }}
    >
      <DialogContent className="p-0">
        <DialogHeader className="px-5 pt-5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <DialogTitle>{t("models.title")}</DialogTitle>
              <DialogDescription>{t("models.subtitle")}</DialogDescription>
            </div>
            <Button
              variant={tab === "manage" ? "accent" : "outline"}
              size="sm"
              onClick={() => setTab((v) => (v === "manage" ? "pick" : "manage"))}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              {t("models.manage")}
            </Button>
          </div>
        </DialogHeader>

        <div className="px-5 pb-5">
          <div className="flex items-center gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("models.searchPlaceholder")} />
            <Button
              variant="outline"
              onClick={() => {
                const trimmed = query.trim();
                if (!trimmed) return;
                pushRecent(trimmed);
                onChange(trimmed);
                onOpenChange(false);
              }}
            >
              {t("models.useCustom")}
            </Button>
          </div>

          {tab === "pick" ? (
            <div className="mt-4">
              <Command className="rounded-lg border border-borderSubtle/60 bg-panel/40 shadow-elev2 shadow-inset">
                <Command.List className="max-h-[420px] overflow-auto p-1">
                  <Command.Empty className="px-3 py-6 text-sm text-muted">{t("models.noResults")}</Command.Empty>

                  {query.trim().length === 0 && recentItems.length > 0 ? (
                    <Command.Group heading={t("models.recent")} className="px-1 py-2">
                      {recentItems.map((it) => {
                        const selected = it.modelId.toLowerCase() === selectedLower;
                        return (
                          <Command.Item
                            key={`recent:${it.modelId}`}
                            value={`${it.providerId} ${it.modelId} ${it.name}`}
                            onSelect={() => {
                              pushRecent(it.modelId);
                              onChange(it.modelId);
                              onOpenChange(false);
                            }}
                            className={cn(
                              "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text outline-none",
                              "aria-selected:bg-panel/70"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{it.name}</span>
                                {it.isCustom ? (
                                  <span className="rounded-full bg-panel/60 px-2 py-0.5 text-[11px] text-muted">custom</span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{it.modelId}</div>
                            </div>
                            {selected ? <Check className="h-4 w-4 text-accent" /> : null}
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  ) : null}

                  {PROVIDER_GROUP_IDS.map((providerId) => {
                    const list = grouped[providerId];
                    if (!list.length) return null;
                    return (
                      <Command.Group key={providerId} heading={groupLabel(t, providerId)} className="px-1 py-2">
                        {list.map((it) => {
                          const selected = it.modelId.toLowerCase() === selectedLower;
                          return (
                            <Command.Item
                              key={`${it.providerId}:${it.modelId}`}
                              value={`${it.providerId} ${it.modelId} ${it.name}`}
                              onSelect={() => {
                                pushRecent(it.modelId);
                                onChange(it.modelId);
                                onOpenChange(false);
                              }}
                              className={cn(
                                "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text outline-none",
                                "aria-selected:bg-panel/70"
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium">{it.name}</span>
                                  {it.recommended ? (
                                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                                      {t("models.recommended")}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{it.modelId}</div>
                              </div>
                              {selected ? <Check className="h-4 w-4 text-accent" /> : null}
                            </Command.Item>
                          );
                        })}
                      </Command.Group>
                    );
                  })}
                </Command.List>
              </Command>
            </div>
          ) : (
            <div className="mt-4">
              <div className="text-sm text-muted">{t("models.manageHint")}</div>

              <div className="mt-3 rounded-lg border border-borderSubtle/60 bg-panel/40 p-2 shadow-elev2 shadow-inset">
                <div className="max-h-[420px] overflow-auto p-1">
                  {PROVIDER_GROUP_IDS.map((providerId) => {
                    const list = baseItems.filter((it) => it.providerId === providerId);
                    if (!list.length) return null;
                    const disabled = new Set(disabledMap[providerId] ?? []);

                    const visibleInManage =
                      query.trim().length >= 2
                        ? list.filter((it) => {
                            const q = query.trim().toLowerCase();
                            return it.modelId.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
                          })
                        : list;

                    return (
                      <div key={providerId} className="py-2">
                        <div className="px-2 text-xs font-medium text-muted">{groupLabel(t, providerId)}</div>
                        <div className="mt-1 grid gap-1">
                          {visibleInManage.map((it) => {
                            const isEnabled = !disabled.has(it.modelId);
                            return (
                              <div
                                key={`${it.providerId}:${it.modelId}:manage`}
                                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-text hover:bg-panel/60"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">{it.name}</div>
                                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{it.modelId}</div>
                                </div>
                                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={(e) => {
                                      const next = readDisabledMap();
                                      const list = new Set(next[providerId] ?? []);
                                      if (e.target.checked) {
                                        list.delete(it.modelId);
                                      } else {
                                        list.add(it.modelId);
                                      }
                                      next[providerId] = Array.from(list).sort();
                                      writeDisabledMap(next);
                                      setDisabledMap(next);
                                    }}
                                    className="h-4 w-4 accent-[color:var(--accent)]"
                                  />
                                  {t("models.visible")}
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
