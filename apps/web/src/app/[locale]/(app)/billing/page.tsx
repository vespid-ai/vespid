"use client";

import { Suspense, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Separator } from "../../../../components/ui/separator";
import { AuthRequiredState } from "../../../../components/app/auth-required-state";
import { useActiveOrgId } from "../../../../lib/hooks/use-active-org-id";
import { useSession as useAuthSession } from "../../../../lib/hooks/use-session";
import { useCheckoutCredits, useCreditLedger, useCreditPacks, useCreditsBalance } from "../../../../lib/hooks/use-billing";
import { isUnauthorizedError } from "../../../../lib/api";

function formatCurrency(unitAmount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(unitAmount / 100);
  } catch {
    return `${unitAmount} ${currency}`;
  }
}

function BillingPageContent() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] ?? "en" : params?.locale ?? "en";
  const orgId = useActiveOrgId();
  const authSession = useAuthSession();
  const scopedOrgId = authSession.data?.session ? orgId : null;
  const searchParams = useSearchParams();

  const status = searchParams.get("status");
  const [cursor, setCursor] = useState<string | null>(null);

  const balanceQuery = useCreditsBalance(scopedOrgId);
  const packsQuery = useCreditPacks(Boolean(scopedOrgId));
  const ledgerQuery = useCreditLedger(scopedOrgId, { limit: 20, cursor });
  const checkout = useCheckoutCredits(scopedOrgId);

  const entries = ledgerQuery.data?.entries ?? [];
  const nextCursor = ledgerQuery.data?.nextCursor ?? null;

  const packs = packsQuery.data?.packs ?? [];
  const packsEnabled = Boolean(packsQuery.data?.enabled);

  const balanceLabel = useMemo(() => {
    const value = balanceQuery.data?.balanceCredits;
    if (typeof value !== "number") return t("common.loading");
    return value.toLocaleString();
  }, [balanceQuery.data?.balanceCredits]);

  if (!authSession.isLoading && !authSession.data?.session) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("billing.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("billing.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void balanceQuery.refetch();
            void packsQuery.refetch();
            void ledgerQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("billing.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("billing.subtitle")}</div>
        </div>
        <EmptyState
          title={t("org.requireActive")}
          action={
            <Button variant="accent" onClick={() => router.push(`/${locale}/org`)}>
              {t("onboarding.goOrg")}
            </Button>
          }
        />
      </div>
    );
  }

  const unauthorized =
    (balanceQuery.isError && isUnauthorizedError(balanceQuery.error)) ||
    (packsQuery.isError && isUnauthorizedError(packsQuery.error)) ||
    (ledgerQuery.isError && isUnauthorizedError(ledgerQuery.error));

  if (unauthorized) {
    return (
      <div className="grid gap-4">
        <div>
          <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("billing.title")}</div>
          <div className="mt-1 text-sm text-muted">{t("billing.subtitle")}</div>
        </div>
        <AuthRequiredState
          locale={locale}
          onRetry={() => {
            void balanceQuery.refetch();
            void packsQuery.refetch();
            void ledgerQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("billing.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("billing.subtitle")}</div>
      </div>

      {status === "success" ? (
        <div className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm text-text">
          {t("billing.status.success")}
        </div>
      ) : status === "cancel" ? (
        <div className="rounded-lg border border-borderSubtle bg-panel/40 p-3 text-sm text-text">
          {t("billing.status.cancel")}
        </div>
      ) : null}

      {!packsEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("billing.topup.disabledTitle")}</CardTitle>
            <CardDescription>{t("billing.topup.disabledDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="https://docs.openclaw.ai" target="_blank" rel="noreferrer">
                {t("billing.setupGuide")}
              </a>
            </Button>
            <Button variant="outline" onClick={() => packsQuery.refetch()}>
              {t("common.refresh")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("billing.balance.title")}</CardTitle>
            <CardDescription>{orgId ? `Org: ${orgId}` : t("org.requireActive")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-semibold tracking-tight text-text">{balanceLabel}</div>
            <div className="mt-1 text-xs text-muted">{t("billing.balance.caption")}</div>

            <Separator className="my-4" />

            <Button onClick={() => balanceQuery.refetch()} disabled={!scopedOrgId}>
              {t("common.refresh")}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("billing.topup.title")}</CardTitle>
            <CardDescription>{t("billing.topup.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {packsQuery.isLoading ? (
              <EmptyState title={t("common.loading")} />
            ) : !packsEnabled ? (
              <EmptyState title={t("billing.topup.disabledTitle")} description={t("billing.topup.disabledDescription")} />
            ) : packs.length === 0 ? (
              <EmptyState title={t("billing.topup.noPacksTitle")} />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {packs.map((pack) => (
                  <div key={pack.packId} className="rounded-2xl border border-borderSubtle bg-panel/60 p-4 shadow-elev1">
                    <div className="text-sm font-medium text-text">{pack.productName ?? t("billing.topup.pack")}</div>
                    <div className="mt-1 text-xs text-muted">{pack.packId}</div>
                    <div className="mt-3 text-2xl font-semibold text-text">{pack.credits.toLocaleString()}</div>
                    <div className="mt-1 text-xs text-muted">{t("billing.credits")}</div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <div className="text-sm text-muted">
                        {typeof pack.unitAmount === "number" && pack.currency ? formatCurrency(pack.unitAmount, pack.currency) : "—"}
                      </div>
                      <Button
                        variant="accent"
                        size="sm"
                        disabled={!scopedOrgId || checkout.isPending}
                        onClick={async () => {
                          if (!scopedOrgId) {
                            toast.error(t("org.requireActive"));
                            return;
                          }
                          try {
                            const res = await checkout.mutateAsync({ packId: pack.packId });
                            window.location.assign(res.checkoutUrl);
                          } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            toast.error(message);
                          }
                        }}
                      >
                        {t("billing.topup.cta")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.ledger.title")}</CardTitle>
          <CardDescription>{t("billing.ledger.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!orgId ? (
            <EmptyState title={t("org.requireActive")} />
          ) : ledgerQuery.isLoading ? (
            <EmptyState title={t("common.loading")} />
          ) : entries.length === 0 ? (
            <EmptyState
              title={t("billing.ledger.emptyTitle")}
              action={
                <Button onClick={() => ledgerQuery.refetch()} disabled={!scopedOrgId}>
                  {t("common.refresh")}
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-borderSubtle">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-panel/60 text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("billing.ledger.when")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("billing.ledger.reason")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("billing.ledger.delta")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-borderSubtle/70">
                      <td className="px-3 py-2 font-mono text-xs text-muted">{new Date(entry.createdAt).toISOString()}</td>
                      <td className="px-3 py-2 text-muted">{entry.reason}</td>
                      <td className={`px-3 py-2 text-right font-medium ${entry.deltaCredits >= 0 ? "text-brand" : "text-danger"}`}>
                        {entry.deltaCredits >= 0 ? "+" : ""}
                        {entry.deltaCredits.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => ledgerQuery.refetch()} disabled={!scopedOrgId}>
              {t("common.refresh")}
            </Button>
            <Button
              variant="outline"
              disabled={!nextCursor}
              onClick={() => {
                setCursor(nextCursor);
              }}
            >
              {t("common.showMore")}
            </Button>
            {cursor ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setCursor(null);
                }}
              >
                {t("common.clearFilters")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-borderSubtle bg-panel/40 p-3 text-sm text-muted">{t("common.loading")}</div>
      }
    >
      <BillingPageContent />
    </Suspense>
  );
}
