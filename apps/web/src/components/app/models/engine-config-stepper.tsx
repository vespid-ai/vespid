"use client";

import { cn } from "../../../lib/cn";

export type EngineWizardStep = {
  id: string;
  title: string;
  description: string;
  status: "done" | "current" | "pending";
};

export function EngineConfigStepper(props: { steps: EngineWizardStep[] }) {
  return (
    <div className="grid gap-2 rounded-xl border border-borderSubtle/60 bg-panel/50 p-3" data-testid="engine-stepper">
      {props.steps.map((step, index) => (
        <div key={step.id} className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
              step.status === "done"
                ? "border-ok/40 bg-ok/10 text-ok"
                : step.status === "current"
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-borderSubtle/70 bg-panel/70 text-muted"
            )}
          >
            {index + 1}
          </div>
          <div className="grid gap-0.5">
            <div className={cn("text-sm font-medium", step.status === "pending" ? "text-muted" : "text-text")}>{step.title}</div>
            <div className="text-xs text-muted">{step.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
