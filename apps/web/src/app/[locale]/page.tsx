"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "../../lib/hooks/use-session";

export default function LocaleHomePage() {
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";
  const session = useSession();

  useEffect(() => {
    if (session.isLoading) {
      return;
    }

    if (session.data?.session) {
      router.replace(`/${locale}/workflows`);
      return;
    }

    router.replace(`/${locale}/auth`);
  }, [locale, router, session.data, session.isLoading]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="rounded-lg border border-border bg-panel/70 p-6 shadow-panel">
        <div className="text-sm text-muted">Redirecting...</div>
        <div className="mt-2 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-text">Vespid</div>
        <div className="mt-1 text-muted">Automation, orchestration, and execution.</div>
      </div>
    </main>
  );
}
