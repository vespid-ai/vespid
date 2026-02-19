"use client";

import { useTranslations } from "next-intl";
import { isOAuthRequiredProvider } from "@vespid/shared/llm/provider-registry";
import { AdvancedSection } from "../advanced-section";
import { LlmConfigField, type LlmConfigMode, type LlmConfigValue } from "./llm-config-field";
import { ModelChipPicker } from "./model-chip-picker";
import type { LlmProviderId } from "./model-catalog";

export function LlmCompactConfigField(props: {
  orgId: string | null;
  mode: LlmConfigMode;
  value: LlmConfigValue;
  onChange: (next: LlmConfigValue) => void;
  allowedProviders?: LlmProviderId[];
  disabled?: boolean;
  advancedSectionId: string;
  testId?: string;
}) {
  const t = useTranslations();
  const testId = props.testId ?? "llm-compact-config";
  const missingSecret = isOAuthRequiredProvider(props.value.providerId) && !props.value.secretId;

  return (
    <div className="grid gap-2" data-testid={testId}>
      <ModelChipPicker
        value={props.value.modelId}
        onChange={(nextModelId) => props.onChange({ ...props.value, modelId: nextModelId })}
        providerFilter={props.value.providerId}
        disabled={Boolean(props.disabled)}
        placeholder={t("sessions.create.modelChipFallback")}
        ariaLabel={t("sessions.create.modelChipAria")}
        clearLabel={t("llm.compact.clearModel")}
        className="max-w-[340px] gap-1.5 rounded-full"
        testId={`${testId}-chip`}
      />

      <AdvancedSection
        id={props.advancedSectionId}
        title={t("llm.compact.advanced")}
        description={t("llm.compact.advancedDescription")}
        labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
      >
        <LlmConfigField
          orgId={props.orgId}
          mode={props.mode}
          value={props.value}
          onChange={props.onChange}
          {...(props.allowedProviders ? { allowedProviders: props.allowedProviders } : {})}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
        />
      </AdvancedSection>

      {missingSecret ? <div className="text-xs text-warn">{t("llm.compact.oauthRequired")}</div> : null}
    </div>
  );
}
