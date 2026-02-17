import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="marketing-wing-veil absolute inset-x-0 top-[-180px] h-[760px] opacity-[0.22]" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
