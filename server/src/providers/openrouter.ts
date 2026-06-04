import type { ProviderAdapter, ProviderCredential, DiscoveredModel, ProviderQuotaProfile } from './types.js';

export const OpenRouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  openAICompatible: true,
  supportsModelListing: true,

  async listModels(credential: ProviderCredential): Promise<DiscoveredModel[]> {
    const url = credential.baseUrl || 'https://openrouter.ai/api/v1';
    const response = await fetch(url + '/models');

    if (!response.ok) {
        throw new Error('Failed to fetch OpenRouter models: ' + response.statusText);
    }

    const data = await response.json() as { data: any[] };

    return data.data.map((m: any) => this.normalizeModel!(m)).filter((m: DiscoveredModel) => this.isFreeModel!(m));
  },

  normalizeModel(raw: any): DiscoveredModel {
    const modelId = raw.id;
    const isFree = modelId.includes(':free') || (raw.pricing && parseFloat(raw.pricing.prompt) === 0 && parseFloat(raw.pricing.completion) === 0);

    return {
      provider: 'openrouter',
      modelId: modelId,
      displayName: raw.name || modelId,
      contextWindow: raw.context_length,
      supportsVision: !!raw.architecture?.modality?.includes('image'),
      supportsTools: !!raw.architecture?.tools,
      supportsStreaming: true,
      raw: raw
    };
  },

  isFreeModel(model: DiscoveredModel): boolean {
    const raw: any = model.raw;
    return model.modelId.includes(':free') || (raw?.pricing && parseFloat(raw.pricing.prompt) === 0 && parseFloat(raw.pricing.completion) === 0);
  },

  getDefaultQuotaProfiles(): ProviderQuotaProfile[] {
    return [
      {
        provider: 'openrouter',
        quotaScope: 'provider_account',
        source: 'default',
        confidence: 'low',
        rpdLimit: 200,
      }
    ];
  }
};
