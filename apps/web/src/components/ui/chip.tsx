import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Chip({ className, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        "transition-[box-shadow,background-color,border-color,color] duration-200",
        active
          ? "border-accent/35 bg-accent/10 text-text shadow-elev1"
          : "border-borderSubtle bg-panel/30 text-muted hover:bg-panel/50 hover:text-text",
        className
      )}
      {...props}
    />
  );
}
