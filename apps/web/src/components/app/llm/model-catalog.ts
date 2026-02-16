import {
  getDefaultModelForProvider,
  inferProviderFromModelId as inferProviderFromModelIdShared,
  listAllCatalogModels,
  listLlmProviders,
  providerSupportsContext,
  type LlmModelCatalogEntry,
  type LlmProviderId,
  type LlmUsageContext,
} from "@vespid/shared";

export type { LlmProviderId };

export type CuratedModel = LlmModelCatalogEntry;

export const curatedModels: CuratedModel[] = listAllCatalogModels();

export const providerLabels: Record<LlmProviderId, string> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, provider.displayName])
) as Record<LlmProviderId, string>;

export const defaultModelByProvider: Record<LlmProviderId, string> = Object.fromEntries(
  listLlmProviders().map((provider) => [provider.id, getDefaultModelForProvider(provider.id) ?? ""])
) as Record<LlmProviderId, string>;

export function inferProviderFromModelId(modelIdRaw: string): LlmProviderId | null {
  return inferProviderFromModelIdShared(modelIdRaw);
}

export function providersForContext(context: LlmUsageContext): LlmProviderId[] {
  return listLlmProviders({ context }).map((p) => p.id);
}

export function canUseProviderInContext(providerId: LlmProviderId, context: LlmUsageContext): boolean {
  return providerSupportsContext(providerId, context);
}
