"use client";

import { ChevronDown, ChevronRight, Copy, Pin, PinOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export type JsonExplorerProps = {
  value: unknown;
  className?: string;
  onPinPath?: (path: string) => void;
  onUnpinPath?: (path: string) => void;
  pinnedPaths?: string[];
  defaultExpandedDepth?: number;
  collapseLongStringsAfter?: number;
  maxNodes?: number;
};

type Node = {
  path: string;
  key: string;
  depth: number;
  kind: "object" | "array" | "primitive";
  value: unknown;
  expandable: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).length}}`;
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

function formatKeyPath(parent: string, key: string): string {
  const simple = /^[A-Za-z0-9_$-]+$/.test(key);
  if (!parent) {
    return simple ? key : `["${key.replaceAll("\"", "\\\"")}"]`;
  }
  return simple ? `${parent}.${key}` : `${parent}["${key.replaceAll("\"", "\\\"")}"]`;
}

function formatIndexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function collectChildren(node: Node): Node[] {
  if (Array.isArray(node.value)) {
    return node.value.map((child, idx) => ({
      path: formatIndexPath(node.path, idx),
      key: `[${idx}]`,
      depth: node.depth + 1,
      kind: Array.isArray(child) ? "array" : isPlainObject(child) ? "object" : "primitive",
      value: child,
      expandable: Array.isArray(child) || isPlainObject(child),
    }));
  }

  if (isPlainObject(node.value)) {
    return Object.entries(node.value).map(([key, child]) => ({
      path: formatKeyPath(node.path, key),
      key,
      depth: node.depth + 1,
      kind: Array.isArray(child) ? "array" : isPlainObject(child) ? "object" : "primitive",
      value: child,
      expandable: Array.isArray(child) || isPlainObject(child),
    }));
  }

  return [];
}

export function JsonExplorer({
  value,
  className,
  onPinPath,
  onUnpinPath,
  pinnedPaths,
  defaultExpandedDepth = 2,
  collapseLongStringsAfter = 180,
  maxNodes = 1200,
}: JsonExplorerProps) {
  const t = useTranslations();
  const pins = new Set((pinnedPaths ?? []).map((p) => p.trim()).filter(Boolean));

  const root: Node = useMemo(() => {
    const kind = Array.isArray(value) ? "array" : isPlainObject(value) ? "object" : "primitive";
    return {
      path: "",
      key: t("common.root"),
      depth: 0,
      kind,
      value,
      expandable: kind !== "primitive",
    };
  }, [t, value]);

  const [open, setOpen] = useState<Set<string>>(() => new Set([""]));
  const [expandedStrings, setExpandedStrings] = useState<Set<string>>(() => new Set());

  function toggleOpen(path: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleString(path: string) {
    setExpandedStrings((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("errors.copyFailed"));
    }
  }

  const visible = useMemo(() => {
    const out: Node[] = [];
    const stack: Node[] = [root];

    while (stack.length && out.length < maxNodes) {
      const node = stack.shift()!;
      out.push(node);

      if (!node.expandable) continue;

      const shouldOpen = open.has(node.path) || node.depth < defaultExpandedDepth;
      if (!shouldOpen) continue;

      const children = collectChildren(node);
      // Stable ordering: object keys in insertion order; arrays by index.
      // Push to front to keep DFS-ish order in a queue.
      stack.unshift(...children.reverse());
    }

    return out;
  }, [defaultExpandedDepth, maxNodes, open, root]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-md)] border border-borderSubtle shadow-elev1 shadow-inset",
        "bg-gradient-to-b from-panel/55 to-panel/35",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-borderSubtle px-3 py-2">
        <div className="text-xs font-medium text-muted">{t("common.json")}</div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(new Set([""]))}>
            {t("common.collapseAll")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              // Open everything currently visible that is expandable.
              const next = new Set<string>([""]);
              for (const node of visible) {
                if (node.expandable) next.add(node.path);
              }
              setOpen(next);
            }}
          >
            {t("common.expandAll")}
          </Button>
        </div>
      </div>

      <div className="max-h-[520px] overflow-auto px-2 py-2 font-mono text-[12px] leading-5">
        {visible.map((node) => {
          const isRoot = node.depth === 0;
          const pad = isRoot ? 0 : (node.depth - 1) * 12;
          const showActions = node.path.length > 0;
          const pinned = node.path.length > 0 && pins.has(node.path);

          const isLongString = typeof node.value === "string" && node.value.length > collapseLongStringsAfter;
          const stringExpanded = expandedStrings.has(node.path);

          const displayValue =
            typeof node.value === "string" && isLongString && !stringExpanded
              ? `${node.value.slice(0, collapseLongStringsAfter)}…`
              : summarize(node.value);

          const caret =
            node.expandable && (open.has(node.path) || node.depth < defaultExpandedDepth) ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : node.expandable ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <span className="inline-block h-3.5 w-3.5" />
            );

          return (
            <div
              key={`${node.path}:${node.depth}`}
              className={cn(
                "group rounded-[var(--radius-sm)] px-2 py-1 transition-colors",
                "hover:bg-panel/45"
              )}
              style={{ paddingLeft: pad }}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => (node.expandable ? toggleOpen(node.path) : undefined)}
                  className={cn(
                    "mt-[2px] text-muted hover:text-text",
                    node.expandable ? "cursor-pointer" : "cursor-default"
                  )}
                  aria-label={node.expandable ? t("common.toggle") : undefined}
                >
                  {caret}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn("text-text", isRoot ? "font-semibold" : "")}>
                      {isRoot ? t("common.root") : node.key}
                    </span>
                    {!isRoot ? <span className="text-muted">:</span> : null}
                    <span className="min-w-0 break-words text-muted">{isRoot ? summarize(node.value) : displayValue}</span>

                    {typeof node.value === "string" && isLongString ? (
                      <button
                        type="button"
                        className="rounded border border-borderSubtle bg-panel/40 px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel/55"
                        onClick={() => toggleString(node.path)}
                      >
                        {stringExpanded ? t("common.showLess") : t("common.showMore")}
                      </button>
                    ) : null}
                  </div>
                </div>

                {showActions ? (
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 border border-borderSubtle bg-panel/40"
                      onClick={() => copy(node.path)}
                      aria-label={t("common.copyPath")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>

                    {onPinPath || onUnpinPath ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 border border-borderSubtle bg-panel/40"
                        onClick={() => {
                          if (pinned) {
                            if (onUnpinPath) {
                              onUnpinPath(node.path);
                              toast.success(t("common.unpinned"));
                            }
                            return;
                          }

                          if (onPinPath) {
                            onPinPath(node.path);
                            toast.success(t("common.pinned"));
                          }
                        }}
                        aria-label={pinned ? t("common.unpin") : t("common.pin")}
                        disabled={pinned ? !onUnpinPath : !onPinPath}
                      >
                        {pinned ? <PinOff className="h-3.5 w-3.5 text-muted" /> : <Pin className="h-3.5 w-3.5" />}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {visible.length >= maxNodes ? (
          <div className="px-2 py-2 text-xs text-muted">{t("common.truncated", { count: maxNodes })}</div>
        ) : null}
      </div>
    </div>
  );
}

export const __testOnly = {
  formatKeyPath,
  formatIndexPath,
};
