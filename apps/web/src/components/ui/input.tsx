import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full rounded-md border border-borderSubtle bg-panel/55 px-3 text-sm text-text",
        "shadow-elev1 outline-none placeholder:text-muted",
        "transition-[box-shadow,background-color,border-color] duration-200",
        "focus:border-accent/40 focus:ring-2 focus:ring-accent/15",
        className
      )}
      {...props}
    />
  );
}
