"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getDefaultConnectorIdForProvider, normalizeConnectorId } from "@vespid/shared/llm/provider-registry";
import { Button } from "../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { useOrgSettings } from "../../../lib/hooks/use-org-settings";
import { useSecrets } from "../../../lib/hooks/use-secrets";
import type { LlmProviderId } from "./model-catalog";

const NONE_SECRET_VALUE = "__none__";
type EngineId = "gateway.codex.v2" | "gateway.claude.v2" | "gateway.opencode.v2";

function llmConnectorIdForProvider(providerId: LlmProviderId): string {
  const connectorId = getDefaultConnectorIdForProvider(providerId);
  if (!connectorId) return "";
  return normalizeConnectorId(connectorId);
}

function providerToEngineId(providerId: LlmProviderId): EngineId | null {
  if (providerId === "anthropic") return "gateway.claude.v2";
  if (providerId === "opencode") return "gateway.opencode.v2";
  if (providerId === "openai" || providerId === "openai-codex") return "gateway.codex.v2";
  return null;
}

export function LlmSecretField(props: {
  orgId: string | null;
  providerId: LlmProviderId;
  value: string | null;
  onChange: (next: string | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";

  const secretsQuery = useSecrets(props.orgId);
  const settingsQuery = useOrgSettings(props.orgId);

  const connectorId = llmConnectorIdForProvider(props.providerId);
  const all = secretsQuery.data?.secrets ?? [];
  const list = useMemo(() => all.filter((s) => normalizeConnectorId(s.connectorId) === connectorId), [all, connectorId]);

  const linkedEngineId = providerToEngineId(props.providerId);
  const linkedEngineAuthDefault = linkedEngineId
    ? settingsQuery.data?.settings?.agents?.engineAuthDefaults?.[linkedEngineId]
    : undefined;
  const linkedEngineSecretId =
    linkedEngineAuthDefault?.mode === "api_key" && typeof linkedEngineAuthDefault?.secretId === "string"
      ? linkedEngineAuthDefault.secretId
      : null;
  const linkedUsesExecutorOauth = linkedEngineAuthDefault?.mode === "oauth_executor";
  const linkedSecretOption = useMemo(() => {
    if (!linkedEngineSecretId) return null;
    if (list.some((secret) => secret.id === linkedEngineSecretId)) return null;
    return {
      id: linkedEngineSecretId,
      name: t("llm.secret.linkedDefaultName"),
      connectorId: "agent.default",
    };
  }, [linkedEngineSecretId, list, t]);
  const selectableList = useMemo(
    () => (linkedSecretOption ? [...list, linkedSecretOption] : list),
    [list, linkedSecretOption]
  );
  const defaultSecret = useMemo(() => {
    const byName = selectableList.find((s) => s.name === "default");
    if (byName) return byName;
    if (linkedEngineSecretId) {
      return selectableList.find((s) => s.id === linkedEngineSecretId) ?? null;
    }
    return null;
  }, [selectableList, linkedEngineSecretId]);

  // Auto-select `name=default` when nothing is selected.
  useEffect(() => {
    if (props.disabled) return;
    if (!props.orgId) return;
    if (props.value) return;
    if (!defaultSecret) return;
    props.onChange(defaultSecret.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.orgId, props.disabled, defaultSecret?.id]);

  const selected = props.value ?? (props.required ? undefined : NONE_SECRET_VALUE);
  const canOperate = Boolean(props.orgId) && !props.disabled;
  const hasAny = selectableList.length > 0;
  const providerNeedsNoSecret = connectorId.length === 0;
  const linkedConnectionAvailable = Boolean(linkedEngineSecretId || linkedUsesExecutorOauth);
  const shouldShowMissingConnection = !providerNeedsNoSecret && props.required && !hasAny && !linkedConnectionAvailable;
  const selectValueProps = selected !== undefined ? { value: selected } : {};

  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <Select
          {...selectValueProps}
          onValueChange={(v) => props.onChange(v === NONE_SECRET_VALUE ? null : v)}
          disabled={!canOperate || providerNeedsNoSecret || (!hasAny && !props.required)}
        >
          <SelectTrigger>
            <SelectValue placeholder={providerNeedsNoSecret ? "No connection required" : hasAny ? "Select connection" : "Not connected"} />
          </SelectTrigger>
          <SelectContent>
            {!props.required ? <SelectItem value={NONE_SECRET_VALUE}>None</SelectItem> : null}
            {selectableList.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {shouldShowMissingConnection ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>No connection configured for {connectorId}.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/${locale}/models`)}>
              Open Model Connections
            </Button>
          </div>
        ) : null}

        {!providerNeedsNoSecret && !props.required && linkedUsesExecutorOauth && !linkedEngineSecretId ? (
          <div className="text-xs text-muted">{t("llm.secret.linkedExecutorOauthHint")}</div>
        ) : null}

        {props.required && !providerNeedsNoSecret && !props.value ? <div className="text-xs text-red-700">Connection is required.</div> : null}
      </div>
    </div>
  );
}
