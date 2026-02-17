"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export function CommandBlock({
  command,
  className,
  copyLabel,
}: {
  command: string;
  className?: string;
  copyLabel?: string;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
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
        aria-label={copyLabel ?? "Copy command"}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
      <pre
        className={[
          "overflow-auto rounded-[var(--radius-md)] border border-borderSubtle p-3 pr-12 text-xs leading-5 shadow-elev1 shadow-inset",
          "bg-gradient-to-b from-surface3/70 to-surface3/45 text-text",
          "dark:from-[rgb(3_7_18)]/95 dark:to-[rgb(3_7_18)]/82 dark:text-[rgb(226_232_240)]",
        ].join(" ")}
      >
        <code className="font-mono">{command}</code>
      </pre>
    </div>
  );
}
