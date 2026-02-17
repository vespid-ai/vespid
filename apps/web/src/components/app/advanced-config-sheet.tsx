"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Sheet, SheetClose, SheetContent } from "../ui/sheet";

export function AdvancedConfigSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-[min(96vw,780px)] rounded-none border-l border-borderSubtle bg-surface1/98 p-0 backdrop-blur supports-[backdrop-filter]:bg-surface1/94",
          props.className
        )}
        aria-describedby={undefined}
        title={props.title}
        {...(props.description ? { description: props.description } : {})}
      >
        <div className="flex h-full flex-col">
          <div className="sticky top-0 z-10 border-b border-borderSubtle bg-surface1/95 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-[var(--font-display)] text-base font-semibold tracking-tight text-text">{props.title}</div>
              </div>
              <SheetClose asChild>
                <Button variant="outline" size="icon" aria-label="Close advanced settings">
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{props.children}</div>

          {props.footer ? (
            <div className="border-t border-borderSubtle bg-surface1/95 px-4 py-3 sm:px-5">{props.footer}</div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
