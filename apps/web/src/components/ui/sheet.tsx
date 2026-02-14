"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({
  className,
  side = "left",
  title,
  description,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "left" | "right";
  title?: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-0 h-dvh w-[min(88vw,360px)] border border-borderSubtle/60 bg-gradient-to-b from-panel/92 to-panel/70 shadow-elev3 shadow-inset outline-none",
          side === "left" ? "left-0 rounded-r-[var(--radius-lg)]" : "right-0 rounded-l-[var(--radius-lg)]",
          "animate-fade-in",
          className
        )}
        {...props}
      >
        {title ? (
          <SheetTitle className="sr-only">{title}</SheetTitle>
        ) : (
          <SheetTitle className="sr-only">Navigation</SheetTitle>
        )}
        {description ? <SheetDescription className="sr-only">{description}</SheetDescription> : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
