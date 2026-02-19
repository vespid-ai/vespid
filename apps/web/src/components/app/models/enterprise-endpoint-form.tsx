"use client";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

export function EnterpriseEndpointForm(props: {
  engineId: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  apiKeyValue: string;
  baseUrlValue: string;
  onApiKeyChange: (next: string) => void;
  onBaseUrlChange: (next: string) => void;
  onSave: () => void;
  onDisconnect: () => void;
  saveLabel: string;
  disconnectLabel: string;
  saveDisabled?: boolean;
  showDisconnect?: boolean;
  helperText?: string;
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-borderSubtle/65 bg-panel/45 p-3">
      <div className="grid gap-1">
        <Label htmlFor={`api-key-input-${props.engineId}`}>{props.apiKeyLabel}</Label>
        <Input
          id={`api-key-input-${props.engineId}`}
          type="password"
          value={props.apiKeyValue}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          placeholder={props.apiKeyPlaceholder}
          data-testid={`api-key-input-${props.engineId}`}
        />
      </div>

      <div className="grid gap-1">
        <Label htmlFor={`base-url-input-${props.engineId}`}>{props.baseUrlLabel}</Label>
        <Input
          id={`base-url-input-${props.engineId}`}
          type="url"
          value={props.baseUrlValue}
          onChange={(event) => props.onBaseUrlChange(event.target.value)}
          placeholder={props.baseUrlPlaceholder}
          data-testid={`base-url-input-${props.engineId}`}
        />
      </div>

      {props.helperText ? <div className="text-xs text-muted">{props.helperText}</div> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="accent" onClick={props.onSave} disabled={props.saveDisabled}>
          {props.saveLabel}
        </Button>
        {props.showDisconnect ? (
          <Button type="button" size="sm" variant="outline" onClick={props.onDisconnect}>
            {props.disconnectLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
