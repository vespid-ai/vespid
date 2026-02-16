"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { cn } from "../../../lib/cn";
import { ModelPickerDialog } from "../model-picker/model-picker-dialog";
import { defaultModelByProvider, inferProviderFromModelId, providerLabels, type LlmProviderId } from "./model-catalog";

export type LlmModelValue = { providerId: LlmProviderId; modelId: string };

export function LlmModelField(props: {
  value: LlmModelValue;
  onChange: (next: LlmModelValue) => void;
  allowedProviders: LlmProviderId[];
  disabled?: boolean;
}) {
  const allowed = useMemo(() => {
    const set = new Set(props.allowedProviders);
    return props.allowedProviders.filter((p) => set.has(p));
  }, [props.allowedProviders]);

  const providerLockedRef = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // If the provider is constrained externally, treat it as locked.
  useEffect(() => {
    providerLockedRef.current = allowed.length <= 1;
  }, [allowed.length]);

  const canEditProvider = !props.disabled && allowed.length > 1;

  function setProvider(nextProvider: LlmProviderId) {
    providerLockedRef.current = true;
    const currentModel = props.value.modelId.trim();
    const inferred = inferProviderFromModelId(currentModel);

    // If the user hasn't customized the model beyond a default, switch to the new provider's default.
    const shouldSwitchModel =
      !currentModel ||
      currentModel === defaultModelByProvider[props.value.providerId] ||
      (inferred !== null && inferred !== nextProvider && currentModel === defaultModelByProvider[inferred]);

    props.onChange({
      providerId: nextProvider,
      modelId: shouldSwitchModel ? defaultModelByProvider[nextProvider] : props.value.modelId,
    });
  }

  function setModelId(raw: string) {
    const modelId = raw;
    if (providerLockedRef.current) {
      props.onChange({ ...props.value, modelId });
      return;
    }
    const inferred = inferProviderFromModelId(modelId);
    const nextProvider = inferred && allowed.includes(inferred) ? inferred : props.value.providerId;
    props.onChange({ providerId: nextProvider, modelId });
  }

  const providerButtons = allowed.map((p) => (
    <Button
      key={p}
      type="button"
      size="sm"
      variant={props.value.providerId === p ? "accent" : "outline"}
      disabled={!canEditProvider}
      onClick={() => setProvider(p)}
    >
      {providerLabels[p]}
    </Button>
  ));

  return (
    <div className="grid gap-2">
      <div className={cn("flex flex-wrap gap-2", allowed.length <= 1 ? "opacity-90" : "")}>
        {providerButtons}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={props.value.modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="e.g. gpt-4.1-mini"
          disabled={props.disabled}
        />
        <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} className="shrink-0" disabled={props.disabled}>
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
      </div>

      <ModelPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={props.value.modelId}
        providerFilter={props.value.providerId}
        onChange={(nextModelId) => {
          // Selecting from the picker is an explicit choice: keep provider locked.
          providerLockedRef.current = true;
          props.onChange({ ...props.value, modelId: nextModelId });
        }}
      />
    </div>
  );
}

