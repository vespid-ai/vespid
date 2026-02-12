import { CodeChallengeMethod, Google, OAuth2Client, decodeIdToken } from "arctic";

export type OAuthProvider = "google" | "github";

export type OAuthStartContext = {
  state: string;
  codeVerifier: string;
  nonce: string;
};

export type OAuthCallbackContext = {
  code: string;
  codeVerifier: string;
  nonce: string;
};

export type OAuthProfile = {
  email: string;
  displayName: string | null;
};

export interface OAuthService {
  createAuthorizationUrl(provider: OAuthProvider, context: OAuthStartContext): URL;
  exchangeCodeForProfile(provider: OAuthProvider, context: OAuthCallbackContext): Promise<OAuthProfile>;
}

type ProviderConfigs = {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
};

function requiredConfig<T>(input: T | undefined, provider: OAuthProvider): T {
  if (!input) {
    throw new Error(`OAUTH_PROVIDER_NOT_CONFIGURED:${provider}`);
  }
  return input;
}

async function fetchJson<T>(url: string, input: { accessToken: string; accept?: string }): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: input.accept ?? "application/json",
      "user-agent": "vespid-foundation",
    },
  });

  if (!response.ok) {
    throw new Error(`OAUTH_PROFILE_FETCH_FAILED:${response.status}`);
  }

  return (await response.json()) as T;
}

export class ArcticOAuthService implements OAuthService {
  private readonly configs: ProviderConfigs;

  constructor(configs: ProviderConfigs) {
    this.configs = configs;
  }

  createAuthorizationUrl(provider: OAuthProvider, context: OAuthStartContext): URL {
    if (provider === "google") {
      const config = requiredConfig(this.configs.google, provider);
      const client = new Google(config.clientId, config.clientSecret, config.redirectUri);
      const url = client.createAuthorizationURL(context.state, context.codeVerifier, ["openid", "email", "profile"]);
      url.searchParams.set("nonce", context.nonce);
      return url;
    }

    const config = requiredConfig(this.configs.github, provider);
    const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
    const url = client.createAuthorizationURLWithPKCE(
      "https://github.com/login/oauth/authorize",
      context.state,
      CodeChallengeMethod.S256,
      context.codeVerifier,
      ["read:user", "user:email"]
    );
    url.searchParams.set("nonce", context.nonce);
    return url;
  }

  async exchangeCodeForProfile(provider: OAuthProvider, context: OAuthCallbackContext): Promise<OAuthProfile> {
    if (provider === "google") {
      const config = requiredConfig(this.configs.google, provider);
      const client = new Google(config.clientId, config.clientSecret, config.redirectUri);
      const tokens = await client.validateAuthorizationCode(context.code, context.codeVerifier);

      const idToken = tokens.idToken();
      const claims = decodeIdToken(idToken) as Record<string, unknown>;
      if (claims.nonce !== context.nonce) {
        throw new Error("OAUTH_INVALID_NONCE");
      }

      let email = typeof claims.email === "string" ? claims.email : null;
      const displayName = typeof claims.name === "string" ? claims.name : null;

      if (!email) {
        const userInfo = await fetchJson<{ email?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
          accessToken: tokens.accessToken(),
        });
        email = userInfo.email ?? null;
      }

      if (!email) {
        throw new Error("OAUTH_EMAIL_REQUIRED");
      }

      return {
        email: email.toLowerCase(),
        displayName,
      };
    }

    const config = requiredConfig(this.configs.github, provider);
    const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
    const tokens = await client.validateAuthorizationCode(
      "https://github.com/login/oauth/access_token",
      context.code,
      context.codeVerifier
    );

    const [profile, emails] = await Promise.all([
      fetchJson<{ name?: string; login?: string; email?: string }>("https://api.github.com/user", {
        accessToken: tokens.accessToken(),
        accept: "application/vnd.github+json",
      }),
      fetchJson<Array<{ email: string; primary: boolean; verified: boolean }>>("https://api.github.com/user/emails", {
        accessToken: tokens.accessToken(),
        accept: "application/vnd.github+json",
      }),
    ]);

    const preferred =
      emails.find((item) => item.primary && item.verified) ?? emails.find((item) => item.verified) ?? null;
    const email = preferred?.email ?? profile.email ?? null;

    if (!email) {
      throw new Error("OAUTH_EMAIL_REQUIRED");
    }

    return {
      email: email.toLowerCase(),
      displayName: profile.name ?? profile.login ?? null,
    };
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

export function createOAuthServiceFromEnv(): OAuthService {
  const googleClientId = readEnv("GOOGLE_CLIENT_ID");
  const googleClientSecret = readEnv("GOOGLE_CLIENT_SECRET");
  const googleRedirectUri = readEnv("GOOGLE_REDIRECT_URI");

  const githubClientId = readEnv("GITHUB_CLIENT_ID");
  const githubClientSecret = readEnv("GITHUB_CLIENT_SECRET");
  const githubRedirectUri = readEnv("GITHUB_REDIRECT_URI");

  const configs: ProviderConfigs = {};

  if (googleClientId && googleClientSecret && googleRedirectUri) {
    configs.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: googleRedirectUri,
    };
  }

  if (githubClientId && githubClientSecret && githubRedirectUri) {
    configs.github = {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      redirectUri: githubRedirectUri,
    };
  }

  return new ArcticOAuthService(configs);
}
