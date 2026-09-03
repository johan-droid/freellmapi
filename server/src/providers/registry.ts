import { getAllProviderDefinitions, type ProviderDefinition } from './definitions/index.js';

export type ProviderRegistryEntry = {
  slug: string;
  displayName: string;
  baseUrl: string;
  modelListEndpoint?: string;
  supportsMultipleAccounts: boolean;
  authType: 'bearer' | 'keyless' | 'custom';
  openAICompatible: boolean;
  defaultHeaders?: Record<string, string>;
  rateLimitStrategy: 'model' | 'account' | 'provider' | 'unknown';
  definition?: ProviderDefinition;
};

export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = getAllProviderDefinitions().map(def => ({
  slug: def.id,
  displayName: def.name,
  baseUrl: def.endpoint.baseUrl,
  modelListEndpoint: def.endpoint.modelListEndpoint,
  supportsMultipleAccounts: def.routing.supportsMultipleAccounts,
  authType: def.auth.type === 'local' ? 'keyless' : def.auth.type === 'custom' || def.auth.type === 'aws_credentials' || def.auth.type === 'service_account' ? 'custom' : 'bearer',
  openAICompatible: def.endpoint.protocol === 'openai-compatible',
  defaultHeaders: def.endpoint.defaultHeaders,
  rateLimitStrategy: def.routing.rateLimitStrategy,
  definition: def,
}));

export function getProviderRegistryEntry(slug: string): ProviderRegistryEntry | undefined {
  return PROVIDER_REGISTRY.find(entry => entry.slug === slug || entry.definition?.aliases.includes(slug));
}
