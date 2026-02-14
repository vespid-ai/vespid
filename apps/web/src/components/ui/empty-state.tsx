import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-[var(--radius-md)] border border-border bg-panel/30 p-8 text-center",
        className
      )}
    >
      {icon ? <div className="text-muted">{icon}</div> : null}
      <div className="mt-3 font-[var(--font-display)] text-base font-semibold tracking-tight text-text">{title}</div>
      {description ? <div className="mt-1 max-w-md text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
