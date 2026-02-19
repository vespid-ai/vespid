"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/button";
import { ModelPickerDialog } from "../model-picker/model-picker-dialog";
import type { LlmProviderId } from "./model-catalog";

export function ModelChipPicker(props: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  providerFilter?: LlmProviderId;
  allowedProviders?: LlmProviderId[];
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const modelLabel = props.value.trim().length > 0 ? props.value.trim() : props.placeholder;
  const canClear = Boolean(props.allowClear) && props.value.trim().length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={Boolean(props.disabled)}
          onClick={() => setOpen(true)}
          aria-label={props.ariaLabel}
          className={props.className ?? "max-w-[320px] gap-1.5 rounded-full"}
          title={modelLabel}
          data-testid={props.testId}
        >
          <span className="truncate">{modelLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        </Button>
        {canClear ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(props.disabled)}
            onClick={() => props.onChange("")}
            data-testid={props.testId ? `${props.testId}-clear` : undefined}
          >
            {props.clearLabel ?? "Clear"}
          </Button>
        ) : null}
      </div>

      <ModelPickerDialog
        open={open}
        onOpenChange={setOpen}
        value={props.value}
        onChange={(nextModelId) => props.onChange(nextModelId)}
        {...(props.providerFilter ? { providerFilter: props.providerFilter } : {})}
        {...(props.allowedProviders ? { allowedProviders: props.allowedProviders } : {})}
      />
    </>
  );
}
