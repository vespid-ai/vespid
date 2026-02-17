"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui/button";

const ADVANCED_COLLAPSED_STORAGE_KEY = "vespid.ui.advanced-collapsed";

type AdvancedCollapsedMap = Record<string, boolean>;

function readMap(): AdvancedCollapsedMap {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(ADVANCED_COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AdvancedCollapsedMap;
  } catch {
    return {};
  }
}

function writeMap(next: AdvancedCollapsedMap): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(ADVANCED_COLLAPSED_STORAGE_KEY, JSON.stringify(next));
}

export function AdvancedSection(props: {
  id: string;
  title: string;
  description?: string;
  defaultCollapsed?: boolean;
  labels: { show: string; hide: string };
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true);

  useEffect(() => {
    const current = readMap();
    const persisted = current[props.id];
    if (typeof persisted === "boolean") {
      setCollapsed(persisted);
      return;
    }
    setCollapsed(props.defaultCollapsed ?? true);
  }, [props.defaultCollapsed, props.id]);

  function toggle() {
    setCollapsed((prev) => {
      const nextValue = !prev;
      const current = readMap();
      current[props.id] = nextValue;
      writeMap(current);
      return nextValue;
    });
  }

  return (
    <div className="grid gap-2 rounded-lg border border-borderSubtle/70 bg-panel/35 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-text">{props.title}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={toggle}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {collapsed ? props.labels.show : props.labels.hide}
        </Button>
      </div>

      {!collapsed ? <div className="grid gap-3">{props.children}</div> : null}
    </div>
  );
}
