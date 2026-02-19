"use client";

import { useTranslations } from "next-intl";
import { inferProviderFromModelId, type LlmProviderId } from "./model-catalog";
import { ModelChipPicker } from "./model-chip-picker";

export function SessionModelChip(props: {
  value: { providerId: LlmProviderId; modelId: string };
  allowedProviders?: LlmProviderId[];
  onChange: (next: { providerId: LlmProviderId; modelId: string }) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();

  return (
    <ModelChipPicker
      value={props.value.modelId}
      {...(props.allowedProviders ? { allowedProviders: props.allowedProviders } : {})}
      disabled={Boolean(props.disabled)}
      placeholder={t("sessions.create.modelChipFallback")}
      ariaLabel={t("sessions.create.modelChipAria")}
      className="max-w-[240px] gap-1.5 rounded-full"
      testId="session-model-chip"
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
  );
}
