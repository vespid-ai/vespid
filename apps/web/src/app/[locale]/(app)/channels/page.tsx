"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Separator } from "../../../../components/ui/separator";
import { AdvancedSection } from "../../../../components/app/advanced-section";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import {
  useApprovePairingRequest,
  useChannelAccounts,
  useChannelCatalog,
  useChannelPairingRequests,
  useCreateChannelAccount,
  useRejectPairingRequest,
} from "../../../../lib/hooks/use-channels";

export default function ChannelsPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";

  const orgId = useActiveOrgId();
  const catalogQuery = useChannelCatalog();

  const [channelId, setChannelId] = useState<string>("whatsapp");
  const [accountKey, setAccountKey] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(true);
  const [dmPolicy, setDmPolicy] = useState<"pairing" | "allowlist" | "open" | "disabled">("pairing");
  const [groupPolicy, setGroupPolicy] = useState<"allowlist" | "open" | "disabled">("allowlist");
  const [requireMentionInGroup, setRequireMentionInGroup] = useState<boolean>(true);
  const [metadataInputs, setMetadataInputs] = useState<Record<string, string>>({});

  const accountsQuery = useChannelAccounts(orgId);
  const pairingQuery = useChannelPairingRequests(orgId, { status: "pending" });

  const createAccount = useCreateChannelAccount(orgId);
  const approvePairing = useApprovePairingRequest(orgId);
  const rejectPairing = useRejectPairingRequest(orgId);

  const channels = catalogQuery.data?.channels ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];
  const pendingRequests = pairingQuery.data?.requests ?? [];
  const selectedChannel = channels.find((item) => item.id === channelId) ?? null;
  const docsBaseUrl = "https://docs.openclaw.ai";

  const selectedMetadataSpecs = selectedChannel?.metadataSpecs ?? [];

  function initializeMetadataInputs(nextChannelId: string): Record<string, string> {
    const selected = channels.find((channel) => channel.id === nextChannelId);
    if (!selected || !Array.isArray(selected.metadataSpecs)) {
      return {};
    }
    const next: Record<string, string> = {};
    for (const spec of selected.metadataSpecs) {
      next[spec.key] = "";
    }
    return next;
  }

  useEffect(() => {
    if (channels.length === 0) {
      return;
    }
    if (!channels.some((channel) => channel.id === channelId)) {
      const first = channels[0]!;
      setChannelId(first.id);
      setDmPolicy((first.defaultDmPolicy as any) ?? "pairing");
      setRequireMentionInGroup(Boolean(first.defaultRequireMentionInGroup));
      setMetadataInputs(initializeMetadataInputs(first.id));
      return;
    }
    if (Object.keys(metadataInputs).length === 0 && selectedMetadataSpecs.length > 0) {
      setMetadataInputs(initializeMetadataInputs(channelId));
    }
  }, [channels, channelId, metadataInputs, selectedMetadataSpecs.length]);

  const channelById = useMemo(() => {
    const map = new Map<string, { label: string; category: string }>();
    for (const channel of channels) {
      map.set(channel.id, { label: channel.label, category: channel.category });
    }
    return map;
  }, [channels]);

  async function onCreateAccount() {
    if (!orgId) {
      toast.error(t("org.requireActive"));
      return;
    }
    const trimmedKey = accountKey.trim();
    if (!trimmedKey) {
      toast.error(t("channels.errors.accountKeyRequired"));
      return;
    }
    try {
      for (const spec of selectedMetadataSpecs) {
        if (spec.required && (metadataInputs[spec.key] ?? "").trim().length === 0) {
          toast.error(t("channels.errors.metadataRequired", { key: spec.key }));
          return;
        }
      }
      const metadata = Object.fromEntries(
        Object.entries(metadataInputs)
          .map(([key, value]) => [key, value.trim()] as const)
          .filter(([, value]) => value.length > 0)
      );
      const payload: {
        channelId: string;
        accountKey: string;
        displayName?: string;
        enabled: boolean;
        dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
        groupPolicy: "allowlist" | "open" | "disabled";
        requireMentionInGroup: boolean;
        webhookUrl?: string;
        metadata?: Record<string, string>;
      } = {
        channelId,
        accountKey: trimmedKey,
        enabled,
        dmPolicy,
        groupPolicy,
        requireMentionInGroup,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
      await createAccount.mutateAsync(payload);
      toast.success(t("channels.create.created"));
      setAccountKey("");
      setDisplayName("");
      setWebhookUrl("");
      setMetadataInputs(initializeMetadataInputs(channelId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function onApprove(requestId: string) {
    try {
      await approvePairing.mutateAsync(requestId);
      toast.success(t("channels.pairing.approved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  async function onReject(requestId: string) {
    try {
      await rejectPairing.mutateAsync(requestId);
      toast.success(t("channels.pairing.rejected"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.unknownError"));
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("channels.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("channels.subtitle")}</div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("channels.create.title")}</CardTitle>
          <CardDescription>{t("channels.create.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("channels.fields.channel")}</Label>
              <Select
                value={channelId}
                onValueChange={(nextChannelId) => {
                  setChannelId(nextChannelId);
                  const selected = channels.find((channel) => channel.id === nextChannelId);
                  if (selected) {
                    setDmPolicy((selected.defaultDmPolicy as any) ?? "pairing");
                    setRequireMentionInGroup(Boolean(selected.defaultRequireMentionInGroup));
                  }
                  setMetadataInputs(initializeMetadataInputs(nextChannelId));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("channels.fields.accountKey")}</Label>
              <Input value={accountKey} onChange={(e) => setAccountKey(e.target.value)} placeholder="primary" />
            </div>
          </div>

          {selectedChannel ? (
              <div className="rounded-xl border border-borderSubtle bg-panel/35 p-3 text-xs text-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono">{selectedChannel.category}</span>
                  <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono">
                    {selectedChannel.supportsWebhook ? "webhook" : selectedChannel.supportsSocketMode ? "socket" : "polling"}
                  </span>
                  <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono">{selectedChannel.onboardingMode}</span>
                  {selectedChannel.requiresExternalRuntime ? (
                    <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono">external-runtime</span>
                  ) : null}
                </div>
              {Array.isArray(selectedChannel.runtimeDependencies) && selectedChannel.runtimeDependencies.length > 0 ? (
                <div className="mt-2">
                  {t("channels.create.dependencies")}:{" "}
                  <span className="font-mono">{selectedChannel.runtimeDependencies.join(", ")}</span>
                </div>
              ) : null}
              {Array.isArray(selectedChannel.onboardingHints) && selectedChannel.onboardingHints.length > 0 ? (
                <div className="mt-1">{selectedChannel.onboardingHints[0]}</div>
              ) : null}
                <div className="mt-1">
                  <a
                    href={`${docsBaseUrl}${selectedChannel.docsPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {t("channels.create.docs")}
                  </a>
                </div>
              </div>
          ) : null}

          {selectedMetadataSpecs.length > 0 ? (
            <div className="grid gap-3 rounded-xl border border-borderSubtle bg-panel/35 p-3 md:grid-cols-2">
              {selectedMetadataSpecs.map((spec) => (
                <div key={spec.key} className="grid gap-2">
                  <Label>
                    {spec.label}
                    {spec.required ? " *" : ""}
                  </Label>
                  <Input
                    value={metadataInputs[spec.key] ?? ""}
                    onChange={(e) => setMetadataInputs((current) => ({ ...current, [spec.key]: e.target.value }))}
                    placeholder={spec.placeholder ?? spec.key}
                  />
                  {spec.description ? <div className="text-xs text-muted">{spec.description}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("channels.fields.displayName")}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label>{t("channels.fields.webhookUrl")}</Label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/webhook" />
            </div>
          </div>

          <AdvancedSection
            id="channels-create-advanced"
            title={t("advanced.title")}
            description={t("advanced.description")}
            labels={{ show: t("advanced.show"), hide: t("advanced.hide") }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>{t("channels.fields.dmPolicy")}</Label>
                <Select value={dmPolicy} onValueChange={(value) => setDmPolicy(value as "pairing" | "allowlist" | "open" | "disabled")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pairing">{t("channels.policy.dm.pairing")}</SelectItem>
                    <SelectItem value="allowlist">{t("channels.policy.dm.allowlist")}</SelectItem>
                    <SelectItem value="open">{t("channels.policy.dm.open")}</SelectItem>
                    <SelectItem value="disabled">{t("channels.policy.dm.disabled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>{t("channels.fields.groupPolicy")}</Label>
                <Select value={groupPolicy} onValueChange={(value) => setGroupPolicy(value as "allowlist" | "open" | "disabled")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist">{t("channels.policy.group.allowlist")}</SelectItem>
                    <SelectItem value="open">{t("channels.policy.group.open")}</SelectItem>
                    <SelectItem value="disabled">{t("channels.policy.group.disabled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>{t("channels.fields.enabled")}</Label>
                <div className="flex h-10 items-center gap-3 rounded-xl border border-borderSubtle bg-panel/45 px-3">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-borderSubtle"
                  />
                  <span className="text-sm text-muted">{enabled ? t("channels.status.enabled") : t("channels.status.disabled")}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-xl border border-borderSubtle bg-panel/45 px-3 py-2">
                <input
                  type="checkbox"
                  checked={requireMentionInGroup}
                  onChange={(e) => setRequireMentionInGroup(e.target.checked)}
                  className="h-4 w-4 rounded border-borderSubtle"
                />
                <div>
                  <div className="text-sm font-medium text-text">{t("channels.fields.requireMentionInGroup")}</div>
                  <div className="text-xs text-muted">{t("channels.security.groupMentionHint")}</div>
                </div>
              </div>
            </div>
          </AdvancedSection>

          <div className="flex justify-end">
            <Button variant="accent" onClick={() => void onCreateAccount()} disabled={!orgId || createAccount.isPending}>
              {t("channels.create.button")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("channels.accounts.title")}</CardTitle>
          <CardDescription>{t("channels.accounts.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <EmptyState
              title={t("channels.accounts.empty")}
              description={t("channels.create.subtitle")}
              action={
                <Button variant="accent" onClick={() => void onCreateAccount()}>
                  {t("channels.create.button")}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-2">
              {accounts.map((account) => {
                const channel = channelById.get(account.channelId);
                return (
                  <div
                    key={account.id}
                    className="grid gap-3 rounded-xl border border-borderSubtle bg-panel/35 p-3 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-text">{account.displayName || account.accountKey}</div>
                        <span className="rounded-full border border-borderSubtle px-2 py-0.5 text-xs text-muted">
                          {channel?.label ?? account.channelId}
                        </span>
                        <span className="rounded-full border border-borderSubtle px-2 py-0.5 font-mono text-xs text-muted">
                          {channel?.category ?? "core"}
                        </span>
                      </div>
                      <div className="text-xs text-muted">
                        {t("channels.accounts.accountKey")}: <span className="font-mono">{account.accountKey}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {t("channels.accounts.state")}: <span className="font-mono">{account.status}</span>
                      </div>
                      {account.lastError ? <div className="text-xs text-red-700">{account.lastError}</div> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => router.push(`/${locale}/channels/${account.id}`)}>
                        {t("channels.accounts.open")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("channels.pairing.title")}</CardTitle>
          <CardDescription>{t("channels.pairing.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {pendingRequests.length === 0 ? (
            <div className="text-sm text-muted">{t("channels.pairing.empty")}</div>
          ) : (
            pendingRequests.map((request) => (
              <div key={request.id} className="rounded-xl border border-borderSubtle bg-panel/35 p-3">
                <div className="grid gap-1 text-sm">
                  <div>
                    <span className="text-muted">{t("channels.pairing.requester")}: </span>
                    <span className="font-mono">{request.requesterDisplayName || request.requesterId}</span>
                  </div>
                  <div>
                    <span className="text-muted">{t("channels.pairing.code")}: </span>
                    <span className="font-mono">{request.code}</span>
                  </div>
                  <div>
                    <span className="text-muted">{t("channels.pairing.expiresAt")}: </span>
                    <span className="font-mono">{request.expiresAt}</span>
                  </div>
                </div>
                <Separator className="my-3" />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="accent" onClick={() => void onApprove(request.id)}>
                    {t("channels.pairing.approve")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void onReject(request.id)}>
                    {t("channels.pairing.reject")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
