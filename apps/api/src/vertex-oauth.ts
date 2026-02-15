import { Google, decodeIdToken } from "arctic";

export type VertexOAuthProfile = {
  email: string;
  displayName: string | null;
};

export type VertexOAuthConnection = {
  refreshToken: string;
  profile: VertexOAuthProfile;
  scopes: string[];
};

export type VertexOAuthStartContext = {
  state: string;
  codeVerifier: string;
  nonce: string;
};

export type VertexOAuthCallbackContext = {
  code: string;
  codeVerifier: string;
  nonce: string;
};

export interface VertexOAuthService {
  createAuthorizationUrl(context: VertexOAuthStartContext): URL;
  exchangeCodeForConnection(context: VertexOAuthCallbackContext): Promise<VertexOAuthConnection>;
}

type VertexOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

async function fetchJson<T>(url: string, input: { accessToken: string }): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      "user-agent": "vespid-foundation",
    },
  });

  if (!response.ok) {
    throw new Error(`VERTEX_OAUTH_PROFILE_FETCH_FAILED:${response.status}`);
  }

  return (await response.json()) as T;
}

export class ArcticVertexOAuthService implements VertexOAuthService {
  private readonly config: VertexOAuthConfig;

  constructor(config: VertexOAuthConfig) {
    this.config = config;
  }

  createAuthorizationUrl(context: VertexOAuthStartContext): URL {
    const client = new Google(this.config.clientId, this.config.clientSecret, this.config.redirectUri);
    const url = client.createAuthorizationURL(context.state, context.codeVerifier, [
      "openid",
      "email",
      "profile",
      // Vertex AI calls run under the connected user's GCP account/project.
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    url.searchParams.set("nonce", context.nonce);
    // Request a refresh token for long-lived connections.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return url;
  }

  async exchangeCodeForConnection(context: VertexOAuthCallbackContext): Promise<VertexOAuthConnection> {
    const client = new Google(this.config.clientId, this.config.clientSecret, this.config.redirectUri);
    const tokens = await client.validateAuthorizationCode(context.code, context.codeVerifier);

    const idToken = tokens.idToken();
    const claims = decodeIdToken(idToken) as Record<string, unknown>;
    if (claims.nonce !== context.nonce) {
      throw new Error("OAUTH_INVALID_NONCE");
    }

    const accessToken = tokens.accessToken();
    let email = typeof claims.email === "string" ? claims.email : null;
    const displayName = typeof claims.name === "string" ? claims.name : null;

    if (!email) {
      const userInfo = await fetchJson<{ email?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
        accessToken,
      });
      email = userInfo.email ?? null;
    }

    if (!email) {
      throw new Error("OAUTH_EMAIL_REQUIRED");
    }

    if (!tokens.hasRefreshToken()) {
      throw new Error("VERTEX_OAUTH_REFRESH_TOKEN_REQUIRED");
    }

    const scopes = tokens.hasScopes() ? tokens.scopes() : [];

    return {
      refreshToken: tokens.refreshToken(),
      scopes,
      profile: {
        email: email.toLowerCase(),
        displayName,
      },
    };
  }
}

export function createVertexOAuthServiceFromEnv(): VertexOAuthService | null {
  const clientId = readEnv("GOOGLE_VERTEX_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_VERTEX_CLIENT_SECRET");
  const redirectUri = readEnv("GOOGLE_VERTEX_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return new ArcticVertexOAuthService({ clientId, clientSecret, redirectUri });
}

