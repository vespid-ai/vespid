import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Chip({ className, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-accent/40 bg-accent/10 text-text"
          : "border-border bg-panel/40 text-muted hover:bg-panel/70 hover:text-text",
        className
      )}
      {...props}
    />
  );
}
