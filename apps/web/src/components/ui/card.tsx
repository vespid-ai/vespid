import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-borderSubtle/60 shadow-elev1 shadow-inset backdrop-blur",
        "bg-gradient-to-b from-panel/82 to-panel/56 supports-[backdrop-filter]:from-panel/72 supports-[backdrop-filter]:to-panel/46",
        "transition-shadow duration-200",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 p-5 group-data-[density=compact]:p-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-[var(--font-display)] text-lg font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-5 pb-5 group-data-[density=compact]:px-4 group-data-[density=compact]:pb-4", className)}
      {...props}
    />
  );
}
