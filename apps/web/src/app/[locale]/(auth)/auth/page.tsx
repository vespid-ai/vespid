"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiFetch, getApiBase } from "../../../../lib/api";
import { useSession } from "../../../../lib/hooks/use-session";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";

function oauthStartUrl(provider: "google" | "github"): string {
  return `${getApiBase()}/v1/auth/oauth/${provider}/start`;
}

export default function AuthPage() {
  const t = useTranslations();
  const params = useParams<{ locale?: string | string[] }>();
  const locale = Array.isArray(params?.locale) ? params.locale[0] : params?.locale ?? "en";
  const session = useSession();

  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);

  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("Password123");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOauthStatus(params.get("oauth"));
    setOauthProvider(params.get("provider"));
    setOauthCode(params.get("code"));
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

  async function signup() {
    const response = await apiFetch("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await response.json();
    session.refetch();
  }

  async function login() {
    const response = await apiFetch("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await response.json();
    session.refetch();
  }

  async function refreshSession() {
    const response = await apiFetch("/v1/auth/refresh", { method: "POST" });
    await response.json();
    session.refetch();
  }

  async function logout() {
    const response = await apiFetch("/v1/auth/logout", { method: "POST" });
    await response.json();
    session.refetch();
  }

  return (
    <div className="grid gap-4">
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
          <CardTitle>{t("auth.sessionTitle")}</CardTitle>
          <CardDescription>
            {session.isLoading
              ? t("common.loading")
              : session.data?.user?.email
                ? t("auth.loggedInAs", { email: session.data.user.email })
                : t("common.notLoggedIn")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => session.refetch()}>
            {t("auth.refresh")}
          </Button>
          <Button variant="danger" onClick={logout}>
            {t("auth.logout")}
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/${locale}/workflows`}>{t("auth.goToApp")}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("auth.passwordLoginTitle")}</CardTitle>
          <CardDescription>{t("auth.passwordLoginDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={signup}>
              {t("auth.signup")}
            </Button>
            <Button variant="outline" onClick={login}>
              {t("auth.login")}
            </Button>
            <Button variant="outline" onClick={refreshSession}>
              {t("auth.refresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("auth.oauth")}</CardTitle>
          <CardDescription>{t("auth.oauthDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
