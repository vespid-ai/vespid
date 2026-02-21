"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { isOAuthRequiredProvider, normalizeConnectorId } from "@vespid/shared/llm/provider-registry";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { ModelPickerDialog } from "../model-picker/model-picker-dialog";
import { ModelChipPicker } from "./model-chip-picker";
import { useSecrets } from "../../../lib/hooks/use-secrets";
import { ProviderPicker } from "./provider-picker";
import {
  defaultModelByProvider,
  inferProviderFromModelId,
  providerConnectorById,
  providerLabels,
  providerRecommendedById,
  type LlmProviderId,
} from "./model-catalog";

export type LlmModelValue = { providerId: LlmProviderId; modelId: string };

export function LlmModelField(props: {
  value: LlmModelValue;
  onChange: (next: LlmModelValue) => void;
  allowedProviders: LlmProviderId[];
  orgId?: string | null;
  disabled?: boolean;
  variant?: "legacy" | "chip";
}) {
  const t = useTranslations();
  const allowed = useMemo(() => {
    const out: LlmProviderId[] = [];
    const seen = new Set<LlmProviderId>();
    for (const providerId of props.allowedProviders) {
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      out.push(providerId);
    }
    return out;
  }, [props.allowedProviders]);

  const providerLockedRef = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const secretsQuery = useSecrets(props.orgId ?? null);

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

  const connectedConnectors = useMemo(() => {
    const secrets = secretsQuery.data?.secrets ?? [];
    return new Set(secrets.map((secret) => normalizeConnectorId(secret.connectorId)));
  }, [secretsQuery.data?.secrets]);

  const providerItems = useMemo(() => {
    return allowed.map((providerId) => {
      const connectorId = providerConnectorById[providerId];
      return {
        id: providerId,
        label: providerLabels[providerId] ?? providerId,
        recommended: providerRecommendedById[providerId] ?? false,
        connected: connectorId ? connectedConnectors.has(connectorId) : true,
        oauth: isOAuthRequiredProvider(providerId),
      };
    });
  }, [allowed, connectedConnectors]);

  if (props.variant === "chip") {
    return (
      <div className="grid gap-2 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] md:items-center">
        <ProviderPicker
          value={props.value.providerId}
          items={providerItems}
          disabled={!canEditProvider}
          onChange={setProvider}
          labels={{
            title: t("providerPicker.title"),
            connected: t("providerPicker.filterConnected"),
            recommended: t("providerPicker.filterRecommended"),
            all: t("providerPicker.filterAll"),
            searchPlaceholder: t("providerPicker.searchProvider"),
            noResults: t("providerPicker.noResults"),
            badgeConnected: t("providerPicker.badgeConnected"),
            badgeRecommended: t("providerPicker.badgeRecommended"),
            badgeOauth: t("providerPicker.badgeOauth"),
          }}
        />

        <ModelChipPicker
          value={props.value.modelId}
          onChange={(nextModelId) => {
            providerLockedRef.current = true;
            props.onChange({ ...props.value, modelId: nextModelId });
          }}
          providerFilter={props.value.providerId}
          placeholder={t("sessions.create.modelChipFallback")}
          ariaLabel={t("sessions.create.modelChipAria")}
          className="w-full max-w-none justify-between gap-1.5 rounded-full"
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)_auto] md:items-center">
      <ProviderPicker
        value={props.value.providerId}
        items={providerItems}
        disabled={!canEditProvider}
        onChange={setProvider}
        labels={{
          title: t("providerPicker.title"),
          connected: t("providerPicker.filterConnected"),
          recommended: t("providerPicker.filterRecommended"),
          all: t("providerPicker.filterAll"),
          searchPlaceholder: t("providerPicker.searchProvider"),
          noResults: t("providerPicker.noResults"),
          badgeConnected: t("providerPicker.badgeConnected"),
          badgeRecommended: t("providerPicker.badgeRecommended"),
          badgeOauth: t("providerPicker.badgeOauth"),
        }}
      />

      <Input
        value={props.value.modelId}
        onChange={(e) => setModelId(e.target.value)}
        placeholder={t("providerPicker.modelPlaceholder")}
        disabled={props.disabled}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => setPickerOpen(true)}
        className="w-full shrink-0 md:w-auto"
        disabled={props.disabled}
      >
        <Search className="mr-2 h-4 w-4" />
        {t("providerPicker.searchModel")}
      </Button>

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
