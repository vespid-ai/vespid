import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-panel/60 px-3 text-sm text-text shadow-sm outline-none placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/15",
        className
      )}
      {...props}
    />
  );
}
