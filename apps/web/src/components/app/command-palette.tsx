"use client";

import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

export type CommandPaletteItem = {
  title: string;
  href: string;
  icon?: LucideIcon;
};

export function CommandPalette({ items, locale }: { items: CommandPaletteItem[]; locale: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const grouped = useMemo(() => {
    const app = items.filter((i) => i.href.startsWith(`/${locale}/`));
    const other = items.filter((i) => !i.href.startsWith(`/${locale}/`));
    return { app, other };
  }, [items, locale]);

  function onSelect(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Search</DialogTitle>
        </DialogHeader>
        <div className="px-5 pb-5">
          <Command className="rounded-lg border border-border bg-panel/50">
            <Command.Input
              placeholder="Type a command or search..."
              className="h-10 w-full bg-transparent px-3 text-sm text-text outline-none placeholder:text-muted"
            />
            <Command.List className="max-h-[340px] overflow-auto border-t border-border">
              <Command.Empty className="px-3 py-4 text-sm text-muted">No results.</Command.Empty>

              <Command.Group heading="Navigation" className="px-1 py-2">
                {grouped.app.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.href}
                      value={item.title}
                      onSelect={() => onSelect(item.href)}
                      className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text outline-none aria-selected:bg-panel"
                    >
                      {Icon ? <Icon className="h-4 w-4 text-muted" /> : null}
                      <span className="flex-1">{item.title}</span>
                      <span className="text-xs text-muted">{item.href}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>

              {grouped.other.length ? (
                <Command.Group heading="Other" className="px-1 py-2">
                  {grouped.other.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={item.title}
                      onSelect={() => onSelect(item.href)}
                      className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-text outline-none aria-selected:bg-panel"
                    >
                      <span className="flex-1">{item.title}</span>
                      <span className="text-xs text-muted">{item.href}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
}
