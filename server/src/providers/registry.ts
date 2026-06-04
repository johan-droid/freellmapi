import { OpenRouterAdapter } from './openrouter.js';
import type { ProviderAdapter, ProviderId } from './types.js';

const registry = new Map<ProviderId, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter) {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: ProviderId): ProviderAdapter | undefined {
  return registry.get(id);
}

export function getAllAdapters(): ProviderAdapter[] {
  return Array.from(registry.values());
}

registerAdapter(OpenRouterAdapter);
