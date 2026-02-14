import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-sm)] border border-border bg-panel/40",
        className
      )}
      {...props}
    />
  );
}
