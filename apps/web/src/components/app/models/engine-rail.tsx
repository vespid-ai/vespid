"use client";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/cn";

export type EngineRailItem = {
  id: string;
  displayName: string;
  recommendedPath: string;
  connected: boolean;
  detail: string;
};

export function EngineRail(props: {
  items: EngineRailItem[];
  selectedId: string | null;
  onSelect: (engineId: string) => void;
  labels: {
    title: string;
    recommended: string;
    connected: string;
    notConnected: string;
  };
}) {
  return (
    <div className="grid gap-2" data-testid="engine-rail">
      <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted">{props.labels.title}</div>
      {props.items.map((item) => {
        const active = props.selectedId === item.id;
        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            className={cn(
              "h-auto justify-start rounded-xl border p-3 text-left",
              active ? "border-accent/60 bg-accent/10 shadow-elev1" : "border-borderSubtle/60 bg-panel/55"
            )}
            onClick={() => props.onSelect(item.id)}
            data-testid={`engine-rail-item-${item.id}`}
          >
            <div className="grid w-full gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-[var(--font-display)] text-base font-semibold">{item.displayName}</div>
                <Badge variant={item.connected ? "ok" : "neutral"}>
                  {item.connected ? props.labels.connected : props.labels.notConnected}
                </Badge>
              </div>
              <div className="text-xs text-muted">{item.detail}</div>
              <div className="text-xs text-muted">
                {props.labels.recommended}: <span className="font-medium text-text">{item.recommendedPath}</span>
              </div>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
