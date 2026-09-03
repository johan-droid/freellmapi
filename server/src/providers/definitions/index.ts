export type ProviderRegion =
  | 'US'
  | 'EU'
  | 'UK'
  | 'CA'
  | 'IN'
  | 'JP'
  | 'KR'
  | 'LOCAL'
  | 'GLOBAL'
  | 'CN'
  | 'OTHER';

export type ProviderJurisdictionClass =
  | 'US'
  | 'EU'
  | 'UK'
  | 'Canada'
  | 'Australia'
  | 'Japan'
  | 'Singapore'
  | 'India'
  | 'South Korea'
  | 'Global'
  | 'China'
  | 'Unknown'
  | 'china'
  | 'non-china';

export type PricingTier = 'free' | 'trial' | 'cheap' | 'standard' | 'premium' | 'enterprise';
export type QualityTier = 'basic' | 'standard' | 'strong' | 'frontier';
export type SpeedTier = 'slow' | 'normal' | 'fast' | 'ultrafast';

export type ProviderAuthType =
  | 'api_key'
  | 'api_token'
  | 'pat'
  | 'oauth'
  | 'aws_credentials'
  | 'service_account'
  | 'local'
  | 'custom';

export type ProviderProtocol =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'google'
  | 'cohere'
  | 'cloudflare'
  | 'aws-bedrock'
  | 'custom';

export type DiscoveryStrategy = 'api' | 'static' | 'hybrid' | 'local' | 'none';

export interface CredentialField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface ProviderAuthDefinition {
  type: ProviderAuthType;
  keyName?: string;
  secretName?: string;
  requiredFields?: CredentialField[];
  keyCreationUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  callbackPath?: string;
  scopes?: string[];
  instructions?: string;
}

export interface ProviderEndpointDefinition {
  protocol: ProviderProtocol;
  baseUrl: string;
  modelListEndpoint?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  embeddings: boolean;
  imageGeneration: boolean;
  audioInput: boolean;
  audioOutput: boolean;
  reasoning: boolean;
}

export interface ProviderModelDiscovery {
  enabled: boolean;
  strategy: DiscoveryStrategy;
  endpoint?: string;
  refreshInterval?: number;
}

export interface ModelPricing {
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  currency: string;
  source: 'provider' | 'models.dev' | 'static' | 'unknown';
  updatedAt?: number;
}

export interface ProviderQuotaMetadata {
  freeTierAvailable: boolean;
  requestsPerDay?: number;
  tokensPerDay?: number;
  notes?: string;
}

export interface ProviderRoutingMetadata {
  networkDependency: boolean;
  defaultTier?: string;
  supportsMultipleAccounts: boolean;
  rateLimitStrategy: 'model' | 'account' | 'provider' | 'unknown';
}

export interface ProviderUIConfig {
  iconName?: string;
  badgeText?: string;
  connectButtonText?: string;
}

export interface ProviderDefinition {
  id: string;
  slug?: string;
  name: string;
  aliases: string[];
  description?: string;
  category?: string;
  website: string;
  websiteUrl?: string;
  documentationUrl?: string;
  docsUrl?: string;
  apiKeyUrl?: string;
  region: ProviderRegion;
  jurisdiction: ProviderJurisdictionClass;
  regionAvailability?: string[];
  dataResidency?: string[];
  tags?: string[];
  enterprise?: boolean;
  selfHosted?: boolean;
  aggregator?: boolean;
  image?: boolean;
  audio?: boolean;
  search?: boolean;
  pricingTier?: PricingTier;
  qualityTier?: QualityTier;
  speedTier?: SpeedTier;
  providerType?: 'native' | 'aggregator' | 'cloud' | 'self_hosted';
  infrastructureGroup?: string;
  enabledByDefault?: boolean;
  auth: ProviderAuthDefinition;
  endpoint: ProviderEndpointDefinition;
  capabilities: ProviderCapabilities;
  modelDiscovery: ProviderModelDiscovery;
  pricing?: ModelPricing;
  quota?: ProviderQuotaMetadata;
  routing: ProviderRoutingMetadata;
  ui?: ProviderUIConfig;
}

const PROVIDER_DEFINITIONS: Map<string, ProviderDefinition> = new Map();

export function defineProvider(def: ProviderDefinition): ProviderDefinition {
  def.slug = def.id;
  def.websiteUrl = def.website;
  def.docsUrl = def.documentationUrl ?? def.website;
  def.apiKeyUrl = def.auth.keyCreationUrl ?? def.website;
  def.enabledByDefault = def.enabledByDefault ?? true;
  def.providerType = def.providerType ?? (def.auth.type === 'local' ? 'self_hosted' : def.aggregator ? 'aggregator' : def.enterprise ? 'cloud' : 'native');
  def.infrastructureGroup = def.infrastructureGroup ?? (def.providerType === 'aggregator' ? `aggregator:${def.id}` : def.id);

  if (PROVIDER_DEFINITIONS.has(def.id)) {
    throw new Error(`Duplicate provider ID registered: ${def.id}`);
  }
  PROVIDER_DEFINITIONS.set(def.id, def);
  return def;
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.get(id);
}

export function getAllProviderDefinitions(): ProviderDefinition[] {
  return Array.from(PROVIDER_DEFINITIONS.values());
}

// -------------------------------------------------------------------------
// CORE INFERENCE & ENTERPRISE & AGGREGATOR PROVIDERS
// -------------------------------------------------------------------------

defineProvider({
  id: 'openai',
  name: 'OpenAI',
  aliases: ['openai', 'gpt'],
  description: 'Official OpenAI platform providing GPT-4o, o1, o3-mini models.',
  website: 'https://openai.com',
  documentationUrl: 'https://platform.openai.com/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'standard',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'OPENAI_API_KEY',
    keyCreationUrl: 'https://platform.openai.com/api-keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: true, audioOutput: true, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api', endpoint: '/models' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'anthropic',
  name: 'Anthropic',
  aliases: ['anthropic', 'claude'],
  description: 'Anthropic Claude 3.5 Sonnet, Claude 3.7 Sonnet & Haiku models.',
  website: 'https://anthropic.com',
  documentationUrl: 'https://docs.anthropic.com',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'standard',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'ANTHROPIC_API_KEY',
    keyCreationUrl: 'https://console.anthropic.com/settings/keys',
  },
  endpoint: {
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'google',
  name: 'Google Gemini',
  aliases: ['google', 'gemini'],
  description: 'Google AI Studio Gemini 2.5, 2.0 Flash, 1.5 Pro and Gemma models.',
  website: 'https://ai.google.dev',
  documentationUrl: 'https://ai.google.dev/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'frontier',
  speedTier: 'ultrafast',
  auth: {
    type: 'api_key',
    keyName: 'GEMINI_API_KEY',
    keyCreationUrl: 'https://aistudio.google.com/app/apikey',
  },
  endpoint: {
    protocol: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    timeoutMs: 60_000,
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: true, audioOutput: true, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  quota: { freeTierAvailable: true, notes: 'Free tier available in Google AI Studio' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'groq',
  name: 'Groq',
  aliases: ['groq'],
  description: 'Ultra-high speed LPU inference for Llama 3.3, DeepSeek-R1, and Qwen.',
  website: 'https://groq.com',
  documentationUrl: 'https://console.groq.com/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'ultrafast',
  auth: {
    type: 'api_key',
    keyName: 'GROQ_API_KEY',
    keyCreationUrl: 'https://console.groq.com/keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: true, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  quota: { freeTierAvailable: true, requestsPerDay: 14400, notes: 'Generous free daily tier' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account', defaultTier: 'fast' },
});

defineProvider({
  id: 'cerebras',
  name: 'Cerebras',
  aliases: ['cerebras'],
  description: 'Wafer-scale engine hardware delivering instant token-generation speeds.',
  website: 'https://cerebras.ai',
  documentationUrl: 'https://inference-docs.cerebras.ai',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'ultrafast',
  auth: {
    type: 'api_key',
    keyName: 'CEREBRAS_API_KEY',
    keyCreationUrl: 'https://cloud.cerebras.ai/platform/keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  quota: { freeTierAvailable: true },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account', defaultTier: 'fast' },
});

defineProvider({
  id: 'ai21',
  name: 'AI21 Labs',
  aliases: ['ai21'],
  description: 'AI21 Studio offering Jamba 1.5 Large, Mini, and Jurassic LLMs.',
  website: 'https://ai21.com',
  documentationUrl: 'https://docs.ai21.com',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'standard',
  qualityTier: 'strong',
  speedTier: 'normal',
  auth: {
    type: 'api_key',
    keyName: 'AI21_API_KEY',
    keyCreationUrl: 'https://studio.ai21.com/account/account',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.ai21.com/studio/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'baseten',
  name: 'Baseten',
  aliases: ['baseten'],
  description: 'Custom open-source model deployment and dedicated GPU infrastructure.',
  website: 'https://baseten.co',
  documentationUrl: 'https://docs.baseten.co',
  region: 'US',
  jurisdiction: 'US',
  enterprise: true,
  pricingTier: 'standard',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'BASETEN_API_KEY',
    keyCreationUrl: 'https://app.baseten.co/settings/api_keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://bridge.baseten.co/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'hybrid' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'deepinfra',
  name: 'DeepInfra',
  aliases: ['deepinfra'],
  description: 'Scalable machine learning inference API for open-source text & vision models.',
  website: 'https://deepinfra.com',
  documentationUrl: 'https://deepinfra.com/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'DEEPINFRA_API_KEY',
    keyCreationUrl: 'https://deepinfra.com/dash/api_keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: true, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'featherless',
  name: 'Featherless AI',
  aliases: ['featherless'],
  description: 'Hassle-free access to thousands of Hugging Face open-weight models.',
  website: 'https://featherless.ai',
  documentationUrl: 'https://featherless.ai/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'standard',
  speedTier: 'normal',
  auth: {
    type: 'api_key',
    keyName: 'FEATHERLESS_API_KEY',
    keyCreationUrl: 'https://featherless.ai/dashboard',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.featherless.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'friendli',
  name: 'FriendliAI',
  aliases: ['friendli'],
  description: 'High-throughput Friendli Suite for open-weight model serving.',
  website: 'https://friendli.ai',
  documentationUrl: 'https://docs.friendli.ai',
  region: 'KR',
  jurisdiction: 'South Korea',
  pricingTier: 'standard',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'FRIENDLI_TOKEN',
    keyCreationUrl: 'https://suite.friendli.ai/team/tokens',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://inference.friendli.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'hyperbolic',
  name: 'Hyperbolic',
  aliases: ['hyperbolic'],
  description: 'Decentralized high-performance GPU AI inference platform.',
  website: 'https://hyperbolic.xyz',
  documentationUrl: 'https://docs.hyperbolic.xyz',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'HYPERBOLIC_API_KEY',
    keyCreationUrl: 'https://app.hyperbolic.xyz',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: false, imageGeneration: true, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'lambda',
  name: 'Lambda AI',
  aliases: ['lambda', 'lambda_labs'],
  description: 'Lambda Cloud GPU inference API for open-source foundation models.',
  website: 'https://lambdalabs.com',
  documentationUrl: 'https://docs.lambdalabs.com',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'LAMBDA_API_KEY',
    keyCreationUrl: 'https://cloud.lambdalabs.com/api-keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.lambdalabs.com/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'nebius',
  name: 'Nebius AI Studio',
  aliases: ['nebius'],
  description: 'European AI cloud platform for fine-tuning & open-source model inference.',
  website: 'https://nebius.com',
  documentationUrl: 'https://docs.nebius.ai',
  region: 'EU',
  jurisdiction: 'EU',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'NEBIUS_API_KEY',
    keyCreationUrl: 'https://studio.nebius.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'nscale',
  name: 'nScale',
  aliases: ['nscale'],
  description: 'Sustainable European GPU cloud provider for AI inference.',
  website: 'https://nscale.com',
  documentationUrl: 'https://docs.nscale.com',
  region: 'EU',
  jurisdiction: 'EU',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'NSCALE_API_KEY',
    keyCreationUrl: 'https://nscale.com',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.nscale.com/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'nous',
  name: 'Nous Research',
  aliases: ['nous', 'nous_research'],
  description: 'Nous Research open-source Hermes & Forge model API server.',
  website: 'https://nousresearch.com',
  documentationUrl: 'https://nousresearch.com',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'normal',
  auth: {
    type: 'api_key',
    keyName: 'NOUS_API_KEY',
    keyCreationUrl: 'https://nousresearch.com',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.nousresearch.com/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'llama_api',
  name: 'Meta Llama API',
  aliases: ['llama_api', 'meta_llama'],
  description: 'Official Meta Llama open-weight foundation model ecosystem.',
  website: 'https://llama.com',
  documentationUrl: 'https://llama.com/docs',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'LLAMA_API_KEY',
    keyCreationUrl: 'https://llama.com',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.llama.com/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'cohere',
  name: 'Cohere',
  aliases: ['cohere'],
  description: 'Command R+, Command R, Embed, and RAG enterprise model suite.',
  website: 'https://cohere.com',
  documentationUrl: 'https://docs.cohere.com',
  region: 'CA',
  jurisdiction: 'Canada',
  pricingTier: 'standard',
  qualityTier: 'strong',
  speedTier: 'normal',
  auth: {
    type: 'api_key',
    keyName: 'COHERE_API_KEY',
    keyCreationUrl: 'https://dashboard.cohere.com/api-keys',
  },
  endpoint: {
    protocol: 'cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'perplexity',
  name: 'Perplexity AI',
  aliases: ['perplexity', 'pplx'],
  description: 'Perplexity Sonar online search & reasoning models API.',
  website: 'https://perplexity.ai',
  documentationUrl: 'https://docs.perplexity.ai',
  region: 'US',
  jurisdiction: 'US',
  search: true,
  pricingTier: 'standard',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'PERPLEXITY_API_KEY',
    keyCreationUrl: 'https://www.perplexity.ai/settings/api',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.perplexity.ai',
  },
  capabilities: {
    chat: true, streaming: true, tools: false, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'xai',
  name: 'xAI (Grok)',
  aliases: ['xai', 'grok'],
  description: 'xAI Grok 2, Grok 2 Vision & frontier reasoning API.',
  website: 'https://x.ai',
  documentationUrl: 'https://docs.x.ai',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'standard',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'XAI_API_KEY',
    keyCreationUrl: 'https://console.x.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'liquid',
  name: 'Liquid AI',
  aliases: ['liquid', 'liquid_ai'],
  description: 'Liquid Neural Network non-transformer efficient foundation models.',
  website: 'https://liquid.ai',
  documentationUrl: 'https://docs.liquid.ai',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'ultrafast',
  auth: {
    type: 'api_key',
    keyName: 'LIQUID_API_KEY',
    keyCreationUrl: 'https://labs.liquid.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.liquid.ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'upstage',
  name: 'Upstage Solar',
  aliases: ['upstage', 'solar'],
  description: 'Upstage Solar Korean & English specialized reasoning & document LLMs.',
  website: 'https://upstage.ai',
  documentationUrl: 'https://developers.upstage.ai',
  region: 'KR',
  jurisdiction: 'South Korea',
  pricingTier: 'standard',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'UPSTAGE_API_KEY',
    keyCreationUrl: 'https://console.upstage.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.upstage.ai/v1/solar',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'morph',
  name: 'Morph Labs',
  aliases: ['morph', 'morph_labs'],
  description: 'Fast open-weights execution with custom routing optimizations.',
  website: 'https://morphlabs.ai',
  documentationUrl: 'https://docs.morphlabs.ai',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'standard',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'MORPH_API_KEY',
    keyCreationUrl: 'https://morphlabs.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.morph.labs/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: false, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'aws_bedrock',
  name: 'AWS Bedrock',
  aliases: ['aws_bedrock', 'bedrock'],
  description: 'Amazon Web Services Bedrock managed foundation models API.',
  website: 'https://aws.amazon.com/bedrock/',
  documentationUrl: 'https://docs.aws.amazon.com/bedrock/',
  region: 'US',
  jurisdiction: 'US',
  enterprise: true,
  pricingTier: 'enterprise',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'aws_credentials',
    keyName: 'AWS_ACCESS_KEY_ID',
    secretName: 'AWS_SECRET_ACCESS_KEY',
    keyCreationUrl: 'https://console.aws.amazon.com/iam/home#/users',
    requiredFields: [
      { name: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID', type: 'text', required: true },
      { name: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', type: 'password', required: true },
      { name: 'AWS_REGION', label: 'AWS Region', type: 'text', required: true, placeholder: 'us-east-1' },
      { name: 'AWS_SESSION_TOKEN', label: 'AWS Session Token (Optional)', type: 'password', required: false },
    ],
  },
  endpoint: {
    protocol: 'aws-bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'google_vertex',
  name: 'Google Vertex AI',
  aliases: ['google_vertex', 'vertex'],
  description: 'Google Cloud Platform Vertex AI enterprise foundational models API.',
  website: 'https://cloud.google.com/vertex-ai',
  documentationUrl: 'https://cloud.google.com/vertex-ai/docs',
  region: 'US',
  jurisdiction: 'US',
  enterprise: true,
  pricingTier: 'enterprise',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'service_account',
    keyName: 'GCP_SERVICE_ACCOUNT_JSON',
    keyCreationUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    requiredFields: [
      { name: 'GCP_PROJECT_ID', label: 'GCP Project ID', type: 'text', required: true },
      { name: 'GCP_LOCATION', label: 'GCP Region / Location', type: 'text', required: true, placeholder: 'us-central1' },
      { name: 'GCP_SERVICE_ACCOUNT_JSON', label: 'Service Account JSON', type: 'textarea', required: true },
    ],
  },
  endpoint: {
    protocol: 'google',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: true, audioOutput: true, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'azure',
  name: 'Azure OpenAI',
  aliases: ['azure', 'azure_openai'],
  description: 'Microsoft Azure OpenAI & Azure AI Model Catalog endpoints.',
  website: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
  documentationUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
  region: 'US',
  jurisdiction: 'US',
  enterprise: true,
  pricingTier: 'enterprise',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'AZURE_OPENAI_API_KEY',
    keyCreationUrl: 'https://portal.azure.com/',
    requiredFields: [
      { name: 'AZURE_OPENAI_API_KEY', label: 'Azure API Key', type: 'password', required: true },
      { name: 'AZURE_OPENAI_ENDPOINT', label: 'Resource Endpoint URL', type: 'text', required: true, placeholder: 'https://your-resource.openai.azure.com' },
      { name: 'AZURE_OPENAI_DEPLOYMENT', label: 'Deployment Name', type: 'text', required: true },
    ],
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://your-resource.openai.azure.com',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: true, audioOutput: true, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'hybrid' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'watsonx',
  name: 'IBM watsonx',
  aliases: ['watsonx', 'ibm_watsonx'],
  description: 'IBM watsonx.ai enterprise foundation model platform.',
  website: 'https://www.ibm.com/watsonx',
  documentationUrl: 'https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-overview.html',
  region: 'US',
  jurisdiction: 'US',
  enterprise: true,
  pricingTier: 'enterprise',
  qualityTier: 'strong',
  speedTier: 'normal',
  auth: {
    type: 'custom',
    keyName: 'IBM_WATSONX_API_KEY',
    keyCreationUrl: 'https://cloud.ibm.com/iam/apikeys',
    requiredFields: [
      { name: 'IBM_WATSONX_API_KEY', label: 'IBM Cloud IAM API Key', type: 'password', required: true },
      { name: 'IBM_WATSONX_PROJECT_ID', label: 'Watsonx Project ID', type: 'text', required: true },
      { name: 'IBM_WATSONX_URL', label: 'Watsonx Instance URL', type: 'text', required: false, placeholder: 'https://us-south.ml.cloud.ibm.com' },
    ],
  },
  endpoint: {
    protocol: 'custom',
    baseUrl: 'https://us-south.ml.cloud.ibm.com',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'scaleway',
  name: 'Scaleway',
  aliases: ['scaleway'],
  description: 'European cloud infrastructure provider offering Generative AI inference.',
  website: 'https://scaleway.com',
  documentationUrl: 'https://www.scaleway.com/en/docs/ai-data/generative-api/',
  region: 'EU',
  jurisdiction: 'EU',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'SCALEWAY_API_KEY',
    keyCreationUrl: 'https://console.scaleway.com/iam/api-keys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.scaleway.com/ai/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'jina',
  name: 'Jina AI',
  aliases: ['jina', 'jina_ai'],
  description: 'Jina AI state-of-the-art embedding, reranker and reader API.',
  website: 'https://jina.ai',
  documentationUrl: 'https://jina.ai/docs',
  region: 'EU',
  jurisdiction: 'EU',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'JINA_API_KEY',
    keyCreationUrl: 'https://jina.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.jina.ai/v1',
  },
  capabilities: {
    chat: true, streaming: true, tools: false, vision: false, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'voyage',
  name: 'Voyage AI',
  aliases: ['voyage', 'voyage_ai'],
  description: 'Voyage AI specialized embedding and reranker model platform.',
  website: 'https://voyageai.com',
  documentationUrl: 'https://docs.voyageai.com',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'frontier',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'VOYAGE_API_KEY',
    keyCreationUrl: 'https://dash.voyageai.com',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.voyageai.com/v1',
  },
  capabilities: {
    chat: false, streaming: false, tools: false, vision: false, structuredOutput: false,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'nomic',
  name: 'Nomic AI',
  aliases: ['nomic', 'nomic_ai'],
  description: 'Nomic Atlas open embedding and text vector models.',
  website: 'https://nomic.ai',
  documentationUrl: 'https://docs.nomic.ai',
  region: 'US',
  jurisdiction: 'US',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'api_key',
    keyName: 'NOMIC_API_KEY',
    keyCreationUrl: 'https://atlas.nomic.ai',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api-atlas.nomic.ai/v1',
  },
  capabilities: {
    chat: false, streaming: false, tools: false, vision: false, structuredOutput: false,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: false,
  },
  modelDiscovery: { enabled: true, strategy: 'static' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

// -------------------------------------------------------------------------
// LOCAL PROVIDERS
// -------------------------------------------------------------------------

defineProvider({
  id: 'ollama_local',
  name: 'Ollama Local',
  aliases: ['ollama_local', 'ollama-local'],
  description: 'Local Ollama server instance running on localhost (default http://localhost:11434).',
  website: 'https://ollama.com',
  documentationUrl: 'https://github.com/ollama/ollama',
  region: 'LOCAL',
  jurisdiction: 'Global',
  selfHosted: true,
  pricingTier: 'free',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'local',
    instructions: 'Make sure Ollama is running locally on http://localhost:11434.',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'local', endpoint: '/models' },
  pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: 'USD', source: 'static' },
  quota: { freeTierAvailable: true, notes: 'Self-hosted zero-cost local inference' },
  routing: { networkDependency: false, supportsMultipleAccounts: true, rateLimitStrategy: 'provider', defaultTier: 'offline' },
  ui: { connectButtonText: 'Detect Local Models' },
});

defineProvider({
  id: 'lmstudio',
  name: 'LM Studio',
  aliases: ['lmstudio'],
  description: 'LM Studio local inference desktop app API server (default http://localhost:1234/v1).',
  website: 'https://lmstudio.ai',
  documentationUrl: 'https://lmstudio.ai/docs',
  region: 'LOCAL',
  jurisdiction: 'Global',
  selfHosted: true,
  pricingTier: 'free',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'local',
    instructions: 'Start Local Server in LM Studio (default port 1234).',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'local', endpoint: '/models' },
  pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: 'USD', source: 'static' },
  quota: { freeTierAvailable: true, notes: 'Self-hosted zero-cost local inference' },
  routing: { networkDependency: false, supportsMultipleAccounts: true, rateLimitStrategy: 'provider', defaultTier: 'offline' },
  ui: { connectButtonText: 'Detect Local Models' },
});

defineProvider({
  id: 'llamacpp',
  name: 'llama.cpp',
  aliases: ['llamacpp', 'llama-cpp'],
  description: 'llama.cpp HTTP server endpoint (default http://localhost:8080/v1).',
  website: 'https://github.com/ggerganov/llama.cpp',
  documentationUrl: 'https://github.com/ggerganov/llama.cpp/tree/master/examples/server',
  region: 'LOCAL',
  jurisdiction: 'Global',
  selfHosted: true,
  pricingTier: 'free',
  qualityTier: 'strong',
  speedTier: 'fast',
  auth: {
    type: 'local',
    instructions: 'Run `./llama-server -m model.gguf --port 8080`.',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:8080/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: false, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'local', endpoint: '/models' },
  pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: 'USD', source: 'static' },
  quota: { freeTierAvailable: true, notes: 'Self-hosted zero-cost local inference' },
  routing: { networkDependency: false, supportsMultipleAccounts: true, rateLimitStrategy: 'provider', defaultTier: 'offline' },
  ui: { connectButtonText: 'Detect Local Models' },
});

defineProvider({
  id: 'vllm',
  name: 'vLLM Engine',
  aliases: ['vllm'],
  description: 'High-throughput vLLM OpenAI-compatible server (default http://localhost:8000/v1).',
  website: 'https://docs.vllm.ai',
  documentationUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
  region: 'LOCAL',
  jurisdiction: 'Global',
  selfHosted: true,
  pricingTier: 'free',
  qualityTier: 'strong',
  speedTier: 'ultrafast',
  auth: {
    type: 'local',
    instructions: 'Run `python3 -m vllm.entrypoints.openai.api_server --model <model>`.',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:8000/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'local', endpoint: '/models' },
  pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0, currency: 'USD', source: 'static' },
  quota: { freeTierAvailable: true, notes: 'Self-hosted zero-cost local inference' },
  routing: { networkDependency: false, supportsMultipleAccounts: true, rateLimitStrategy: 'provider', defaultTier: 'offline' },
  ui: { connectButtonText: 'Detect Local Models' },
});

// -------------------------------------------------------------------------
// CHINA PROVIDERS (EXCLUSION POLICY APPLIED BY DEFAULT)
// -------------------------------------------------------------------------

defineProvider({
  id: 'zhipu',
  name: 'Zhipu AI',
  aliases: ['zhipu', 'bigmodel'],
  description: 'Zhipu AI (bigmodel.cn / z.ai) GLM model family.',
  website: 'https://open.bigmodel.cn',
  documentationUrl: 'https://open.bigmodel.cn/dev/api',
  region: 'CN',
  jurisdiction: 'China',
  pricingTier: 'cheap',
  qualityTier: 'strong',
  speedTier: 'normal',
  enabledByDefault: false,
  auth: {
    type: 'api_key',
    keyName: 'ZHIPU_API_KEY',
    keyCreationUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelListEndpoint: '/models',
    timeoutMs: 60_000,
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: true, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});

defineProvider({
  id: 'modelscope',
  name: 'ModelScope',
  aliases: ['modelscope'],
  description: 'Alibaba Cloud ModelScope open-source AI community gateway.',
  website: 'https://modelscope.cn',
  documentationUrl: 'https://modelscope.cn/docs',
  region: 'CN',
  jurisdiction: 'China',
  pricingTier: 'free',
  qualityTier: 'standard',
  speedTier: 'normal',
  enabledByDefault: false,
  auth: {
    type: 'api_key',
    keyName: 'MODELSCOPE_API_KEY',
    keyCreationUrl: 'https://modelscope.cn/my/myplus',
  },
  endpoint: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    modelListEndpoint: '/models',
  },
  capabilities: {
    chat: true, streaming: true, tools: true, vision: true, structuredOutput: true,
    embeddings: true, imageGeneration: false, audioInput: false, audioOutput: false, reasoning: true,
  },
  modelDiscovery: { enabled: true, strategy: 'api' },
  routing: { networkDependency: true, supportsMultipleAccounts: true, rateLimitStrategy: 'account' },
});
