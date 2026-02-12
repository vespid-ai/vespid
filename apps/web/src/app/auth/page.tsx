"use client";

import { useMemo, useState } from "react";
import { useEffect } from "react";
import { apiFetch, getApiBase } from "../../lib/api";

type AuthPayload = {
  session?: { token: string; expiresAt: number };
  user?: { id: string; email: string };
  code?: string;
  message?: string;
};

function oauthStartUrl(provider: "google" | "github"): string {
  return `${getApiBase()}/v1/auth/oauth/${provider}/start`;
}

export default function AuthPage() {
  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);

  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("Password123");
  const [result, setResult] = useState<AuthPayload | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOauthStatus(params.get("oauth"));
    setOauthProvider(params.get("provider"));
    setOauthCode(params.get("code"));
  }, []);

  const oauthBanner = useMemo(() => {
    if (oauthStatus === "success") {
      return `OAuth login succeeded (${oauthProvider ?? "provider"}).`;
    }
    if (oauthStatus === "error") {
      return `OAuth login failed: ${oauthCode ?? "unknown_error"}`;
    }
    return null;
  }, [oauthCode, oauthProvider, oauthStatus]);

  async function signup() {
    const response = await apiFetch("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setResult(await response.json());
  }

  async function login() {
    const response = await apiFetch("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setResult(await response.json());
  }

  async function refreshSession() {
    const response = await apiFetch("/v1/auth/refresh", {
      method: "POST",
    });
    setResult(await response.json());
  }

  async function logout() {
    const response = await apiFetch("/v1/auth/logout", {
      method: "POST",
    });
    setResult(await response.json());
  }

  return (
    <main>
      <h1>Auth</h1>

      {oauthBanner ? (
        <div className="card">
          <strong>{oauthBanner}</strong>
        </div>
      ) : null}

      <div className="card">
        <label htmlFor="email">Email</label>
        <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
        />

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={signup}>Sign up</button>
          <button onClick={login}>Login</button>
          <button onClick={refreshSession}>Refresh session</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

      <div className="card">
        <strong>OAuth</strong>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <a href={oauthStartUrl("google")}>Continue with Google</a>
          <a href={oauthStartUrl("github")}>Continue with GitHub</a>
        </div>
      </div>

      {result ? (
        <div className="card">
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </main>
  );
}
