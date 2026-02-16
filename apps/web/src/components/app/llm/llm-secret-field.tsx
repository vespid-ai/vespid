"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDefaultConnectorIdForProvider, normalizeConnectorId } from "@vespid/shared/llm/provider-registry";
import { Button } from "../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { useSecrets } from "../../../lib/hooks/use-secrets";
import type { LlmProviderId } from "./model-catalog";

const NONE_SECRET_VALUE = "__none__";

function llmConnectorIdForProvider(providerId: LlmProviderId): string {
  const connectorId = getDefaultConnectorIdForProvider(providerId);
  if (!connectorId) return "";
  return normalizeConnectorId(connectorId);
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
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";

  const secretsQuery = useSecrets(props.orgId);

  const connectorId = llmConnectorIdForProvider(props.providerId);
  const all = secretsQuery.data?.secrets ?? [];
  const list = useMemo(() => all.filter((s) => normalizeConnectorId(s.connectorId) === connectorId), [all, connectorId]);
  const defaultSecret = useMemo(() => list.find((s) => s.name === "default") ?? null, [list]);

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
  const hasAny = list.length > 0;
  const providerNeedsNoSecret = connectorId.length === 0;
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
            <SelectValue placeholder={providerNeedsNoSecret ? "No secret required" : hasAny ? "Select secret" : "Not connected"} />
          </SelectTrigger>
          <SelectContent>
            {!props.required ? <SelectItem value={NONE_SECRET_VALUE}>None</SelectItem> : null}
            {list.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.id.slice(0, 8)}…)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!providerNeedsNoSecret && !hasAny ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>No secret configured for {connectorId}.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/${locale}/secrets`)}>
              Go to Secrets
            </Button>
          </div>
        ) : null}

        {props.required && !providerNeedsNoSecret && !props.value ? <div className="text-xs text-red-700">Secret is required.</div> : null}
      </div>
    </div>
  );
}
