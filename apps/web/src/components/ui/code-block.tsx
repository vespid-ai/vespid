"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "../../lib/cn";
import { Button } from "./button";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function CodeBlock({ value, className }: { value: unknown; className?: string }) {
  const text = useMemo(() => safeStringify(value), [value]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 900);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 border border-border bg-panel/60"
        onClick={copy}
        aria-label="Copy JSON"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <pre className="overflow-auto rounded-lg border border-border bg-[rgb(2_6_23)]/95 p-3 text-xs text-[rgb(226_232_240)]">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}
