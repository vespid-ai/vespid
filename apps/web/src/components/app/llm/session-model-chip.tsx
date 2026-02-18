"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../ui/button";
import { ModelPickerDialog } from "../model-picker/model-picker-dialog";
import { inferProviderFromModelId, type LlmProviderId } from "./model-catalog";

export function SessionModelChip(props: {
  value: { providerId: LlmProviderId; modelId: string };
  allowedProviders?: LlmProviderId[];
  onChange: (next: { providerId: LlmProviderId; modelId: string }) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const modelLabel = props.value.modelId.trim().length > 0 ? props.value.modelId.trim() : t("sessions.create.modelChipFallback");

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        aria-label={t("sessions.create.modelChipAria")}
        className="max-w-[240px] gap-1.5 rounded-full"
        title={modelLabel}
        data-testid="session-model-chip"
      >
        <span className="truncate">{modelLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </Button>

      <ModelPickerDialog
        open={open}
        onOpenChange={setOpen}
        value={props.value.modelId}
        providerFilter={props.value.providerId}
        onChange={(nextModelId) => {
          const inferred = inferProviderFromModelId(nextModelId);
          const allowInferred =
            inferred && (!props.allowedProviders || props.allowedProviders.length === 0 || props.allowedProviders.includes(inferred));
          props.onChange({
            providerId: allowInferred ? inferred : props.value.providerId,
            modelId: nextModelId,
          });
        }}
      />
    </>
  );
}
