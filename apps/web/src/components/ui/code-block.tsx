"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations();
  const text = useMemo(() => safeStringify(value), [value]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 900);
    } catch {
      toast.error(t("errors.copyFailed"));
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 border border-borderSubtle bg-panel/55 shadow-elev1 shadow-inset"
        onClick={copy}
        aria-label="Copy JSON"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <pre
        className={[
          "overflow-auto rounded-[var(--radius-md)] border border-borderSubtle p-3 text-xs leading-5 shadow-elev1 shadow-inset",
          // Light: slightly tinted slate for a premium, less harsh code surface.
          "bg-gradient-to-b from-surface3/70 to-surface3/45 text-text",
          // Dark: deep navy surface for long debugging sessions.
          "dark:from-[rgb(3_7_18)]/95 dark:to-[rgb(3_7_18)]/82 dark:text-[rgb(226_232_240)]",
        ].join(" ")}
      >
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}
