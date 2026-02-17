"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { useSecrets } from "../../../lib/hooks/use-secrets";

const NONE_SECRET_VALUE = "__none__";

export function SecretSelectField(props: {
  orgId: string | null;
  connectorId: string;
  value: string | null;
  onChange: (next: string | null) => void;
  required?: boolean;
  autoSelectDefaultName?: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";

  const secretsQuery = useSecrets(props.orgId);

  const all = secretsQuery.data?.secrets ?? [];
  const list = useMemo(() => all.filter((s) => s.connectorId === props.connectorId), [all, props.connectorId]);
  const defaultName = props.autoSelectDefaultName ?? "default";
  const defaultSecret = useMemo(() => list.find((s) => s.name === defaultName) ?? null, [defaultName, list]);

  useEffect(() => {
    if (props.disabled) return;
    if (!props.orgId) return;
    if (props.value) return;
    if (!defaultSecret) return;
    props.onChange(defaultSecret.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.orgId, props.disabled, defaultSecret?.id]);

  const selected = props.value ?? NONE_SECRET_VALUE;
  const canOperate = Boolean(props.orgId) && !props.disabled;
  const hasAny = list.length > 0;

  return (
    <div className="grid gap-2">
      <Select value={selected} onValueChange={(v) => props.onChange(v === NONE_SECRET_VALUE ? null : v)} disabled={!canOperate}>
        <SelectTrigger>
          <SelectValue placeholder={hasAny ? "Select connection" : "Not connected"} />
        </SelectTrigger>
        <SelectContent>
          {!props.required ? <SelectItem value={NONE_SECRET_VALUE}>None</SelectItem> : null}
          {list.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!hasAny ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>No connection configured for {props.connectorId}.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/${locale}/models`)}>
            Open Connections
          </Button>
        </div>
      ) : null}

      {props.required && !props.value ? <div className="text-xs text-red-700">Connection is required.</div> : null}
    </div>
  );
}
