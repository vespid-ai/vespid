import {
  communityFeatureCapabilities,
  type EnterpriseProvider,
  type FeatureCapability,
  type EnterpriseConnectorContract,
} from "@vespid/shared";

export function createCommunityProvider(): EnterpriseProvider {
  return {
    edition: "community",
    name: "community-core",
    getCapabilities() {
      return [...communityFeatureCapabilities];
    },
    getEnterpriseConnectors() {
      return [];
    },
  };
}

function isEnterpriseConnector(value: unknown): value is EnterpriseConnectorContract {
  if (!value || typeof value !== "object") {
    return false;
  }

  const connector = value as Partial<EnterpriseConnectorContract>;
  return (
    typeof connector.id === "string" &&
    typeof connector.displayName === "string" &&
    typeof connector.requiresSecret === "boolean"
  );
}

function isEnterpriseProvider(value: unknown): value is EnterpriseProvider {
  if (!value || typeof value !== "object") {
    return false;
  }

  const provider = value as Partial<EnterpriseProvider>;
  if (
    (provider.edition !== "community" && provider.edition !== "enterprise") ||
    typeof provider.name !== "string" ||
    typeof provider.getCapabilities !== "function"
  ) {
    return false;
  }

  if (provider.version !== undefined && typeof provider.version !== "string") {
    return false;
  }

  if (provider.getEnterpriseConnectors !== undefined && typeof provider.getEnterpriseConnectors !== "function") {
    return false;
  }

  return true;
}

function normalizeCapabilities(values: FeatureCapability[]): FeatureCapability[] {
  return [...new Set(values)];
}

type ProviderLoaderInput = {
  inlineProvider?: EnterpriseProvider;
  modulePath?: string;
  logger?: {
    info(payload: unknown, msg?: string): void;
    warn(payload: unknown, msg?: string): void;
  };
};

export async function loadEnterpriseProvider(input: ProviderLoaderInput = {}): Promise<EnterpriseProvider> {
  if (input.inlineProvider) {
    return input.inlineProvider;
  }

  const modulePath = input.modulePath ?? process.env.VESPID_ENTERPRISE_PROVIDER_MODULE;
  if (!modulePath) {
    return createCommunityProvider();
  }

  try {
    const imported = await import(modulePath);
    const candidate = imported.enterpriseProvider ?? imported.default;

    if (!isEnterpriseProvider(candidate)) {
      input.logger?.warn(
        {
          event: "enterprise_provider_invalid",
          modulePath,
        },
        "enterprise provider invalid; falling back to community provider"
      );
      return createCommunityProvider();
    }

    input.logger?.info(
      {
        event: "enterprise_provider_loaded",
        modulePath,
        provider: candidate.name,
        edition: candidate.edition,
      },
      "enterprise provider loaded"
    );

    return candidate;
  } catch (error) {
    input.logger?.warn(
      {
        event: "enterprise_provider_load_failed",
        modulePath,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to load enterprise provider; falling back to community provider"
    );
    return createCommunityProvider();
  }
}

export function resolveEditionCapabilities(provider: EnterpriseProvider): FeatureCapability[] {
  const capabilities = provider.getCapabilities();
  return normalizeCapabilities([...communityFeatureCapabilities, ...capabilities]);
}

export function resolveEnterpriseConnectors(provider: EnterpriseProvider): EnterpriseConnectorContract[] {
  const raw = provider.getEnterpriseConnectors?.() ?? [];
  return raw.filter((item) => isEnterpriseConnector(item));
}
