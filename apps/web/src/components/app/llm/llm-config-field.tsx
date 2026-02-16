"use client";

import { LlmModelField, type LlmModelValue } from "./llm-model-field";
import { LlmSecretField } from "./llm-secret-field";
import type { LlmProviderId } from "./model-catalog";

export type LlmConfigMode = "session" | "workflowAgentRun" | "toolsetBuilder";

export type LlmConfigValue = {
  providerId: LlmProviderId;
  modelId: string;
  secretId: string | null;
};

function allowedProvidersForMode(mode: LlmConfigMode): LlmProviderId[] {
  if (mode === "session") return ["openai", "anthropic", "gemini"];
  if (mode === "toolsetBuilder") return ["openai", "anthropic"];
  return ["openai", "anthropic", "gemini", "vertex"];
}

export function LlmConfigField(props: {
  orgId: string | null;
  mode: LlmConfigMode;
  value: LlmConfigValue;
  onChange: (next: LlmConfigValue) => void;
  allowedProviders?: LlmProviderId[];
  disabled?: boolean;
}) {
  const allowedProviders = props.allowedProviders ?? allowedProvidersForMode(props.mode);

  const modelValue: LlmModelValue = { providerId: props.value.providerId, modelId: props.value.modelId };
  const secretRequired = props.mode === "toolsetBuilder" || props.value.providerId === "vertex";
  const showSecret = props.mode !== "session";

  return (
    <div className="grid gap-3">
      <LlmModelField
        value={modelValue}
        allowedProviders={allowedProviders}
        disabled={props.disabled ?? false}
        onChange={(next) => {
          // If provider changes, clear secret so auto-default selection can re-run.
          const providerChanged = next.providerId !== props.value.providerId;
          props.onChange({
            ...props.value,
            providerId: next.providerId,
            modelId: next.modelId,
            ...(providerChanged ? { secretId: null } : {}),
          });
        }}
      />

      {showSecret ? (
        <LlmSecretField
          orgId={props.orgId}
          providerId={props.value.providerId}
          value={props.value.secretId}
          required={secretRequired}
          disabled={props.disabled ?? false}
          onChange={(next) => props.onChange({ ...props.value, secretId: next })}
        />
      ) : null}
    </div>
  );
}
