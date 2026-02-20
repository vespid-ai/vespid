import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LlmSecretField } from "../components/app/llm/llm-secret-field";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useSecretsReturn: { data: { secrets: [] } } as any,
  useOrgSettingsReturn: { data: { settings: {} } } as any,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ locale: "en" }),
}));

vi.mock("../lib/hooks/use-secrets", () => ({
  useSecrets: () => mocks.useSecretsReturn,
}));

vi.mock("../lib/hooks/use-org-settings", () => ({
  useOrgSettings: () => mocks.useOrgSettingsReturn,
}));

describe("LlmSecretField", () => {
  const messages = {
    llm: {
      secret: {
        linkedDefaultName: "default (Model Connections)",
        linkedExecutorOauthHint: "Using executor OAuth from Model Connections.",
      },
    },
  } as const;

  it("does not show missing-connection warning when model connections has API key default", () => {
    mocks.useSecretsReturn = { data: { secrets: [] } };
    mocks.useOrgSettingsReturn = {
      data: {
        settings: {
          agents: {
            engineAuthDefaults: {
              "gateway.codex.v2": {
                mode: "api_key",
                secretId: "sec_from_model_connections",
              },
            },
          },
        },
      },
    };

    render(
      <NextIntlClientProvider locale="en" messages={messages as any}>
        <LlmSecretField
          orgId="org_1"
          providerId="openai"
          value={null}
          required={false}
          onChange={() => {}}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByText(/No connection configured for llm\.openai\./)).not.toBeInTheDocument();
  });

  it("shows executor-oauth hint when linked engine uses oauth_executor", () => {
    mocks.useSecretsReturn = { data: { secrets: [] } };
    mocks.useOrgSettingsReturn = {
      data: {
        settings: {
          agents: {
            engineAuthDefaults: {
              "gateway.codex.v2": {
                mode: "oauth_executor",
              },
            },
          },
        },
      },
    };

    render(
      <NextIntlClientProvider locale="en" messages={messages as any}>
        <LlmSecretField
          orgId="org_1"
          providerId="openai"
          value={null}
          required={false}
          onChange={() => {}}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Using executor OAuth from Model Connections.")).toBeInTheDocument();
    expect(screen.queryByText(/No connection configured for llm\.openai\./)).not.toBeInTheDocument();
  });
});
