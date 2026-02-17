import { Suspense } from "react";
import ModelConnectionsClientPage from "./model-connections-client";

export default function ModelConnectionsPage() {
  return (
    <Suspense fallback={<div className="rounded-[var(--radius-md)] border border-borderSubtle bg-panel/35 p-4 text-sm text-muted">Loading...</div>}>
      <ModelConnectionsClientPage />
    </Suspense>
  );
}
