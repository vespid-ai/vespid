"use client";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/cn";

export type ConnectionPathCardItem = {
  id: "oauth_executor" | "api_key";
  title: string;
  description: string;
  recommended?: boolean;
};

export function ConnectionPathCards(props: {
  value: "oauth_executor" | "api_key";
  items: ConnectionPathCardItem[];
  onChange: (next: "oauth_executor" | "api_key") => void;
  labels: {
    recommended: string;
    selected: string;
  };
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {props.items.map((item) => {
        const selected = props.value === item.id;
        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            onClick={() => props.onChange(item.id)}
            className={cn(
              "h-auto min-w-0 items-start justify-start whitespace-normal rounded-xl border p-3 text-left",
              selected
                ? "border-accent/80 bg-accent/14 shadow-elev2 ring-2 ring-accent/25"
                : "border-borderSubtle/60 bg-panel/50"
            )}
            aria-pressed={selected}
            data-state={selected ? "active" : "inactive"}
            data-testid={`connection-path-${item.id}`}
          >
            <div className="grid min-w-0 w-full gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="break-words font-medium text-text">{item.title}</div>
                {item.recommended ? <Badge variant="accent">{props.labels.recommended}</Badge> : null}
                {selected ? <Badge variant="ok">{props.labels.selected}</Badge> : null}
              </div>
              <div className="break-words whitespace-normal text-xs leading-relaxed text-muted">{item.description}</div>
            </div>
          </Button>
        );
      })}
    </div>
  );
}
