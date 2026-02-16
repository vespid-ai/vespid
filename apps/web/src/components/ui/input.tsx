import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-[var(--radius-sm)] border border-borderSubtle/60 px-3 text-sm text-text outline-none placeholder:text-muted",
        "bg-panel/90 shadow-elev1",
        "transition-[box-shadow,background-color,border-color] duration-200 hover:bg-panel hover:shadow-elev2",
        "focus:border-accent/40 focus:ring-2 focus:ring-accent/15",
        className
      )}
      {...props}
    />
  );
}
