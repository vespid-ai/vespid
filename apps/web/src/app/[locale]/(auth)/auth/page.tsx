"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch, apiFetchJson, getApiBase } from "../../../../lib/api";
import { setActiveOrgId } from "../../../../lib/org-context";
import { useSession } from "../../../../lib/hooks/use-session";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";

function oauthStartUrl(provider: "google" | "github"): string {
  return `${getApiBase()}/v1/auth/oauth/${provider}/start`;
}

type MeResponse = {
  user: { id: string; email: string };
  orgs: Array<{ id: string; name: string; roleKey: string }>;
  defaultOrgId: string | null;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function AuthPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";
  const session = useSession();

  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setOauthStatus(query.get("oauth"));
    setOauthProvider(query.get("provider"));
    setOauthCode(query.get("code"));
  }, []);

  const oauthBanner = useMemo(() => {
    if (oauthStatus === "success") {
      return {
        tone: "ok" as const,
        text: t("auth.oauthSuccess", { provider: oauthProvider ?? "provider" }),
      };
    }
    if (oauthStatus === "error") {
      return {
        tone: "danger" as const,
        text: t("auth.oauthError", { code: oauthCode ?? "unknown_error" }),
      };
    }
    return null;
  }, [oauthCode, oauthProvider, oauthStatus, t]);

  const enterChat = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const me = await apiFetchJson<MeResponse>("/v1/me", { method: "GET" });
        const fallbackOrgId = Array.isArray(me.orgs) && me.orgs.length > 0 ? me.orgs[0]?.id ?? null : null;
        const activeOrgId = me.defaultOrgId ?? fallbackOrgId;
        if (activeOrgId) {
          setActiveOrgId(activeOrgId);
        }
        if (activeOrgId || attempt === 1) {
          router.replace(`/${locale}/conversations`);
          return;
        }
      } catch {
        // Retry once because OAuth/session cookies can settle asynchronously.
      }
      await wait(250);
    }
    router.replace(`/${locale}/conversations`);
  }, [locale, router]);

  useEffect(() => {
    if (session.isLoading || !session.data?.session) {
      return;
    }
    void enterChat();
  }, [enterChat, session.data?.session, session.isLoading]);

  async function runAuth(path: "/v1/auth/signup" | "/v1/auth/login") {
    setPending(true);
    setErrorText("");
    try {
      const response = await apiFetch(path, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload.message === "string" ? payload.message : t("common.unknownError");
        throw new Error(message);
      }
      await session.refetch();
      await enterChat();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("common.unknownError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <div>
        <div className="font-[var(--font-display)] text-3xl font-semibold tracking-tight">{t("auth.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("auth.subtitle")}</div>
      </div>

      {oauthBanner ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant={oauthBanner.tone === "ok" ? "ok" : "danger"}>
                {oauthBanner.tone === "ok" ? t("common.ok") : t("common.error")}
              </Badge>
              <CardTitle>{t("auth.oauth")}</CardTitle>
            </div>
            <CardDescription>{oauthBanner.text}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("auth.passwordLoginTitle")}</CardTitle>
          <CardDescription>{t("auth.passwordLoginDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>

          {errorText ? <div className="text-sm text-red-700">{errorText}</div> : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="accent" onClick={() => void runAuth("/v1/auth/login")} disabled={pending}>
              {pending ? t("common.loading") : t("auth.login")}
            </Button>
            <Button variant="outline" onClick={() => void runAuth("/v1/auth/signup")} disabled={pending}>
              {pending ? t("common.loading") : t("auth.signup")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("auth.oauth")}</CardTitle>
          <CardDescription>{t("auth.oauthDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Button asChild variant="outline">
            <a href={oauthStartUrl("google")}>{t("auth.google")}</a>
          </Button>
          <Button asChild variant="outline">
            <a href={oauthStartUrl("github")}>{t("auth.github")}</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
