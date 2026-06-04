export type ProviderId = string;

export interface ProviderCredential {
  id: number;
  providerAccountId: number;
  provider: string;
  label: string;
  decryptedKey: string;
  baseUrl?: string | null;
  enabled: boolean;
  status: string;
}

export interface DiscoveredModel {
  provider: string;
  modelId: string;
  displayName: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  raw?: unknown;
}

export interface ProviderQuotaProfile {
  provider: string;
  modelId?: string;
  rpmLimit?: number | null;
  rpdLimit?: number | null;
  tpmLimit?: number | null;
  tpdLimit?: number | null;
  monthlyTokenBudget?: number | null;
  quotaScope: 'credential' | 'provider_account' | 'provider_global' | 'model' | 'unknown';
  source: 'manual' | 'provider_api' | 'inferred' | 'default';
  confidence: 'high' | 'medium' | 'low';
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  openAICompatible: boolean;
  supportsModelListing: boolean;
  listModels?(credential: ProviderCredential): Promise<DiscoveredModel[]>;
  getDefaultQuotaProfiles?(): ProviderQuotaProfile[];
  normalizeModel?(raw: unknown): DiscoveredModel;
  isFreeModel?(model: DiscoveredModel): boolean;
  supportsCredential?(credential: ProviderCredential): boolean;
}
