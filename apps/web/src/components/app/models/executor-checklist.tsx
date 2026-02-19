"use client";

import { Button } from "../../ui/button";

export function ExecutorChecklist(props: {
  lines: string[];
  onlineExecutors: number;
  verifiedCount: number;
  unverifiedCount: number;
  onRecheck: () => void;
  labels: {
    onlineExecutors: string;
    verified: string;
    unverified: string;
    recheck: string;
  };
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-borderSubtle/65 bg-panel/45 p-3 text-xs text-muted">
      {props.lines.map((line) => (
        <div key={line}>{line}</div>
      ))}

      <div className="grid gap-1 rounded-lg border border-borderSubtle/55 bg-panel/60 p-2">
        <div>{props.labels.onlineExecutors.replace("{count}", String(props.onlineExecutors))}</div>
        <div>{props.labels.verified.replace("{count}", String(props.verifiedCount))}</div>
        <div>{props.labels.unverified.replace("{count}", String(props.unverifiedCount))}</div>
      </div>

      <div>
        <Button type="button" size="sm" variant="outline" onClick={props.onRecheck}>
          {props.labels.recheck}
        </Button>
      </div>
    </div>
  );
}
