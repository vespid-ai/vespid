"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import { cn } from "../../lib/cn";
import { Button } from "./button";

function normalizeLanguage(input: string | null | undefined): string {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!raw) {
    return "text";
  }
  if (raw === "ts") return "typescript";
  if (raw === "tsx") return "tsx";
  if (raw === "js") return "javascript";
  if (raw === "jsx") return "jsx";
  if (raw === "shell" || raw === "sh") return "bash";
  if (raw === "zsh" || raw === "console") return "bash";
  if (raw === "yml") return "yaml";
  if (raw === "md") return "markdown";
  if (raw === "py") return "python";
  return raw;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function displayLanguage(language: string): string {
  if (language === "text") {
    return "TEXT";
  }
  return language.toUpperCase();
}

export function SyntaxCodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string | null;
  className?: string;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const normalizedLanguage = normalizeLanguage(language);

  const highlighted = useMemo(() => {
    const grammar = Prism.languages[normalizedLanguage];
    if (!grammar) {
      return escapeHtml(code);
    }
    return Prism.highlight(code, grammar, normalizedLanguage);
  }, [code, normalizedLanguage]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 900);
    } catch {
      toast.error(t("errors.copyFailed"));
    }
  }

  return (
    <div className={cn("syntax-code overflow-hidden rounded-xl border border-borderSubtle/80 shadow-elev1", className)}>
      <div className="syntax-code__header flex items-center justify-between border-b border-borderSubtle/70 px-3 py-1.5">
        <div className="text-[11px] font-semibold tracking-wide text-muted">{displayLanguage(normalizedLanguage)}</div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 border border-borderSubtle/75 bg-panel/55 text-muted hover:text-text"
          onClick={copy}
          aria-label={t("common.copy")}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="syntax-code__pre max-h-[360px] overflow-auto px-3 py-2 text-xs leading-6">
        <code
          className={`syntax-code__content language-${normalizedLanguage} font-mono`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
