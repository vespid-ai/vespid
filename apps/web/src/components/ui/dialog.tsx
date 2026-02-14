import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-borderSubtle bg-panel/90 p-5 shadow-elev3 outline-none",
          "animate-fade-in",
          className
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("mb-4", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-[var(--font-display)] text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm text-muted", className)} {...props} />;
}
