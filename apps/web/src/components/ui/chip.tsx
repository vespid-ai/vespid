import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Chip({ className, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        "transition-[box-shadow,background-color,border-color,color] duration-200",
        active
          ? "ui-selected border-accent/90 font-semibold ring-1 ring-accent/40"
          : "border-borderSubtle bg-panel/30 text-muted hover:bg-panel/50 hover:text-text",
        className
      )}
      {...props}
    />
  );
}
