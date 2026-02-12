"use client";

import { useState } from "react";

type AuthPayload = {
  session?: { token: string };
  user?: { id: string; email: string };
  code?: string;
  message?: string;
};

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";
}

export default function AuthPage() {
  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("Password123");
  const [result, setResult] = useState<AuthPayload | null>(null);

  async function signup() {
    const response = await fetch(`${getApiBase()}/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setResult(await response.json());
  }

  async function login() {
    const response = await fetch(`${getApiBase()}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setResult(await response.json());
  }

  async function oauth() {
    const response = await fetch(`${getApiBase()}/v1/auth/oauth/google/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: `bootstrap-${Date.now()}`,
        state: "valid-oauth-state",
        email,
      }),
    });
    setResult(await response.json());
  }

  return (
    <main>
      <h1>Auth Bootstrap</h1>
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

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={signup}>Sign up</button>
          <button onClick={login}>Login</button>
          <button onClick={oauth}>OAuth callback</button>
        </div>
        <small>Copy the returned bearer token for org endpoints.</small>
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
