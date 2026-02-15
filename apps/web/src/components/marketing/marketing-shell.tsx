import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="grid-lines absolute inset-0 opacity-[0.24]" />
        <div className="noise-overlay absolute inset-0 opacity-[0.45]" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
