"use client";

import { Command } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { cn } from "../../../lib/cn";
import type { LlmProviderId } from "./model-catalog";

const PROVIDER_FILTER_MODE_STORAGE_KEY = "vespid.ui.provider-filter-mode";

export type ProviderFilterMode = "connected" | "recommended" | "all";

export type ProviderPickerItem = {
  id: LlmProviderId;
  label: string;
  recommended: boolean;
  connected: boolean;
  oauth: boolean;
};

function readFilterMode(): ProviderFilterMode {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return "recommended";
  }
  const raw = window.localStorage.getItem(PROVIDER_FILTER_MODE_STORAGE_KEY);
  return raw === "connected" || raw === "recommended" || raw === "all" ? raw : "recommended";
}

function writeFilterMode(mode: ProviderFilterMode): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(PROVIDER_FILTER_MODE_STORAGE_KEY, mode);
}

export function ProviderPicker(props: {
  value: LlmProviderId;
  items: ProviderPickerItem[];
  disabled?: boolean;
  onChange: (next: LlmProviderId) => void;
  labels: {
    title: string;
    connected: string;
    recommended: string;
    all: string;
    searchPlaceholder: string;
    noResults: string;
    badgeConnected: string;
    badgeRecommended: string;
    badgeOauth: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<ProviderFilterMode>("recommended");

  useEffect(() => {
    setFilterMode(readFilterMode());
  }, []);

  const selected = useMemo(() => {
    return props.items.find((it) => it.id === props.value) ?? null;
  }, [props.items, props.value]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = props.items.filter((it) => {
      if (filterMode === "connected" && !it.connected && it.id !== props.value) return false;
      if (filterMode === "recommended" && !it.connected && !it.recommended && it.id !== props.value) return false;
      if (!q) return true;
      return it.label.toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
    });

    out.sort((a, b) => {
      if (a.id === props.value) return -1;
      if (b.id === props.value) return 1;
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return out;
  }, [filterMode, props.items, props.value, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={props.disabled}
          aria-label={props.labels.title}
        >
          <span className="truncate">{selected?.label ?? props.value}</span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[360px] p-2">
        <div className="px-1 pb-2 pt-1 text-xs font-medium text-muted">{props.labels.title}</div>

        <div className="mb-2 flex flex-wrap gap-2 px-1">
          <Button
            type="button"
            size="sm"
            variant={filterMode === "recommended" ? "accent" : "outline"}
            onClick={() => {
              setFilterMode("recommended");
              writeFilterMode("recommended");
            }}
          >
            {props.labels.recommended}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filterMode === "connected" ? "accent" : "outline"}
            onClick={() => {
              setFilterMode("connected");
              writeFilterMode("connected");
            }}
          >
            {props.labels.connected}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filterMode === "all" ? "accent" : "outline"}
            onClick={() => {
              setFilterMode("all");
              writeFilterMode("all");
            }}
          >
            {props.labels.all}
          </Button>
        </div>

        <Command shouldFilter={false} className="rounded-lg border border-borderSubtle/60 bg-panel/35 shadow-elev1">
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={props.labels.searchPlaceholder}
            className="h-9 w-full border-b border-borderSubtle/60 bg-transparent px-3 text-sm text-text outline-none placeholder:text-muted"
          />

          <Command.List className="max-h-[280px] overflow-auto p-1">
            <Command.Empty className="px-3 py-6 text-sm text-muted">{props.labels.noResults}</Command.Empty>

            {visible.map((it) => {
              const active = it.id === props.value;
              return (
                <Command.Item
                  key={it.id}
                  value={`${it.id} ${it.label}`}
                  onSelect={() => {
                    props.onChange(it.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text outline-none",
                    "aria-selected:bg-panel/70"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{it.label}</span>
                      {it.connected ? <Badge variant="ok">{props.labels.badgeConnected}</Badge> : null}
                      {!it.connected && it.recommended ? <Badge variant="neutral">{props.labels.badgeRecommended}</Badge> : null}
                      {it.oauth ? <Badge variant="accent">{props.labels.badgeOauth}</Badge> : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">{it.id}</div>
                  </div>

                  {active ? <Check className="h-4 w-4 text-accent" /> : null}
                </Command.Item>
              );
            })}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
