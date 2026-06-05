import type { DiscoveredModel, ProviderAccountForDiscovery } from './types.js';
import { getProviderRegistryEntry } from '../registry.js';

function normalizeModel(providerSlug: string, raw: Record<string, unknown>): DiscoveredModel | null {
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.name === 'string' ? raw.name : null;
  if (!id) return null;
  return {
    provider_slug: providerSlug,
    provider_model_id: id,
    display_name: typeof raw.name === 'string' ? raw.name : id,
    context_window: typeof raw.context_length === 'number' ? raw.context_length : typeof raw.context_window === 'number' ? raw.context_window : null,
    max_output_tokens: typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : null,
    supports_tools: JSON.stringify(raw).includes('tools'),
    supports_vision: JSON.stringify(raw).includes('image') || JSON.stringify(raw).includes('vision'),
    supports_streaming: true,
    supports_json: JSON.stringify(raw).includes('response_format') || JSON.stringify(raw).includes('json'),
    input_modalities: [],
    output_modalities: [],
    raw_metadata_json: raw,
  };
}

export async function discoverProviderModels(account: ProviderAccountForDiscovery): Promise<DiscoveredModel[]> {
  const registry = getProviderRegistryEntry(account.providerSlug);
  if (!registry?.modelListEndpoint) return [];

  const base = account.baseUrl?.replace(/\/+$/, '') || registry.baseUrl.replace(/\/+$/, '');
  const endpoint = registry.modelListEndpoint.startsWith('http') ? registry.modelListEndpoint : `${base}${registry.modelListEndpoint}`;
  if (!endpoint) return [];

  const headers: Record<string, string> = { ...(registry.defaultHeaders ?? {}) };
  if (registry.authType !== 'keyless' && account.apiKey && account.apiKey !== 'no-key') {
    headers['x-api-key'] = account.apiKey;
  }

  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error(`${account.providerSlug} catalog discovery failed with HTTP ${response.status}`);
  const json = await response.json() as { data?: unknown[] } | unknown[];
  const data = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
  return data
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => normalizeModel(account.providerSlug, item))
    .filter((item): item is DiscoveredModel => item !== null);
}
