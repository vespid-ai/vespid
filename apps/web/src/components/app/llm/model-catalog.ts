import {
  getDefaultModelForProvider,
  inferProviderFromModelId as inferProviderFromModelIdShared,
  listAllCatalogModels,
  listLlmProviders,
  normalizeConnectorId,
  providerSupportsContext,
  type LlmModelCatalogEntry,
  type LlmProviderMeta,
  type LlmProviderId,
  type LlmUsageContext,
} from "@vespid/shared/llm/provider-registry";

export type { LlmProviderId };

export type CuratedModel = LlmModelCatalogEntry;

export const curatedModels: CuratedModel[] = listAllCatalogModels();

export const providerLabels: Record<LlmProviderId, string> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, provider.displayName])
) as Record<LlmProviderId, string>;

export const defaultModelByProvider: Record<LlmProviderId, string> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, getDefaultModelForProvider(provider.id) ?? ""])
) as Record<LlmProviderId, string>;

export const providerMetaById: Record<LlmProviderId, LlmProviderMeta> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, provider])
) as Record<LlmProviderId, LlmProviderMeta>;

export const providerRecommendedById: Record<LlmProviderId, boolean> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, provider.tags.includes("recommended") || provider.tags.includes("popular")])
) as Record<LlmProviderId, boolean>;

export const providerConnectorById: Record<LlmProviderId, string | null> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, provider.defaultConnectorId ? normalizeConnectorId(provider.defaultConnectorId) : null])
) as Record<LlmProviderId, string | null>;

export function inferProviderFromModelId(modelIdRaw: string): LlmProviderId | null {
  return inferProviderFromModelIdShared(modelIdRaw);
}

export function providersForContext(context: LlmUsageContext): LlmProviderId[] {
  return listLlmProviders({ context }).map((p) => p.id);
}

export function canUseProviderInContext(providerId: LlmProviderId, context: LlmUsageContext): boolean {
  return providerSupportsContext(providerId, context);
}
