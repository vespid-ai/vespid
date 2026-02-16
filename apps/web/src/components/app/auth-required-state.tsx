"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";

export function AuthRequiredState(props: { locale: string; onRetry?: () => void }) {
  const t = useTranslations();
  const router = useRouter();

  return (
    <EmptyState
      title={t("errors.authRequired.title")}
      description={t("errors.authRequired.description")}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="accent" onClick={() => router.push(`/${props.locale}/auth`)}>
            {t("errors.authRequired.signIn")}
          </Button>
          <Button variant="outline" onClick={() => props.onRetry?.()}>
            {t("common.refresh")}
          </Button>
        </div>
      }
    />
  );
}

