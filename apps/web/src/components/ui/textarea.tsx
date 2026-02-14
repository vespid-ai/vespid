import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[90px] w-full rounded-md border border-border bg-panel/60 px-3 py-2 text-sm text-text shadow-sm outline-none placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/15",
        className
      )}
      {...props}
    />
  );
}
