import type { DiscoveredModel, ProviderAccountForDiscovery } from './types.js';
import { getProviderRegistryEntry } from '../registry.js';
import { getProviderDefinition } from '../definitions/index.js';

function normalizeModel(providerSlug: string, raw: Record<string, unknown>): DiscoveredModel | null {
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.name === 'string' ? raw.name : null;
  if (!id) return null;

  const jsonStr = JSON.stringify(raw).toLowerCase();
  const def = getProviderDefinition(providerSlug);

  return {
    provider_slug: providerSlug,
    provider_model_id: id,
    display_name: typeof raw.name === 'string' ? raw.name : id,
    context_window: typeof raw.context_length === 'number'
      ? raw.context_length
      : typeof raw.context_window === 'number'
      ? raw.context_window
      : typeof raw.max_context_length === 'number'
      ? raw.max_context_length
      : 128000,
    max_output_tokens: typeof raw.max_completion_tokens === 'number'
      ? raw.max_completion_tokens
      : typeof raw.max_output_tokens === 'number'
      ? raw.max_output_tokens
      : 4096,
    supports_tools: def?.capabilities.tools ?? (jsonStr.includes('tool') || jsonStr.includes('function')),
    supports_vision: def?.capabilities.vision ?? (jsonStr.includes('image') || jsonStr.includes('vision') || id.includes('vision') || id.includes('vl') || id.includes('4o')),
    supports_streaming: def?.capabilities.streaming ?? true,
    supports_json: def?.capabilities.structuredOutput ?? (jsonStr.includes('response_format') || jsonStr.includes('json') || jsonStr.includes('structured')),
    input_modalities: ['text'],
    output_modalities: ['text'],
    raw_metadata_json: raw,
  };
}

export async function discoverProviderModels(account: ProviderAccountForDiscovery): Promise<DiscoveredModel[]> {
  const registry = getProviderRegistryEntry(account.providerSlug);
  const def = getProviderDefinition(account.providerSlug);

  if (!registry?.modelListEndpoint && def?.modelDiscovery.strategy !== 'static') {
    return [];
  }

  const base = account.baseUrl?.replace(/\/+$/, '') || registry?.baseUrl.replace(/\/+$/, '') || def?.endpoint.baseUrl.replace(/\/+$/, '') || '';
  const endpoint = registry?.modelListEndpoint
    ? (registry.modelListEndpoint.startsWith('http') ? registry.modelListEndpoint : `${base}${registry.modelListEndpoint}`)
    : `${base}/models`;

  if (!endpoint) return [];

  const headers: Record<string, string> = { ...(registry?.defaultHeaders ?? {}) };
  if (registry?.authType !== 'keyless' && account.apiKey && account.apiKey !== 'no-key') {
    headers['Authorization'] = `Bearer ${account.apiKey}`;
    headers['x-api-key'] = account.apiKey;
  }

  try {
    const response = await fetch(endpoint, { headers });
    if (!response.ok) {
      if (def?.modelDiscovery.strategy === 'static') {
        return getFallbackStaticModels(account.providerSlug);
      }
      throw new Error(`${account.providerSlug} catalog discovery failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as { data?: unknown[]; models?: unknown[] } | unknown[];
    const data = Array.isArray(json)
      ? json
      : Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
      ? json.models
      : [];

    const models = data
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(item => normalizeModel(account.providerSlug, item))
      .filter((item): item is DiscoveredModel => item !== null);

    if (models.length === 0 && def) {
      return getFallbackStaticModels(account.providerSlug);
    }

    return models;
  } catch (err) {
    if (def?.modelDiscovery.strategy === 'static' || def?.modelDiscovery.strategy === 'hybrid') {
      return getFallbackStaticModels(account.providerSlug);
    }
    throw err;
  }
}

function getFallbackStaticModels(providerSlug: string): DiscoveredModel[] {
  const def = getProviderDefinition(providerSlug);
  if (!def) return [];

  return [
    {
      provider_slug: providerSlug,
      provider_model_id: `${providerSlug}-default`,
      display_name: `${def.name} Default Model`,
      context_window: 128000,
      max_output_tokens: 4096,
      supports_tools: def.capabilities.tools,
      supports_vision: def.capabilities.vision,
      supports_streaming: def.capabilities.streaming,
      supports_json: def.capabilities.structuredOutput,
      input_modalities: ['text'],
      output_modalities: ['text'],
      raw_metadata_json: { staticFallback: true },
    },
  ];
}
