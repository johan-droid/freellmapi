// ---- Platform & Model Types ----

// Active platforms — must match server/src/providers/index.ts and
// server/src/routes/keys.ts PLATFORMS allowlist.
// Moonshot and MiniMax direct integrations were dropped in migrateModelsV4
// (see server/src/db/index.ts). HuggingFace was dropped in V4 and re-added
// in V13 via the router.huggingface.co Inference Providers meta-router.
export type Platform =
  | 'google'
  | 'groq'
  | 'cerebras'
  | 'sambanova'
  | 'nvidia'
  | 'mistral'
  | 'openrouter'
  | 'github'
  | 'cohere'
  | 'cloudflare'
  | 'zhipu'
  | 'ollama'
  | 'kilo'
  | 'pollinations'
  | 'llm7'
  | 'huggingface'
  // OpenCode Zen — OpenAI-compatible gateway. Free promotional models require a
  // free (no-card) account key from opencode.ai/auth; see migrateModelsV18.
  | 'opencode'
  // User-configured OpenAI-compatible endpoint (llama.cpp, LM Studio, vLLM,
  // Ollama, any base_url). The endpoint URL lives on the api_keys row; see #117.
  | 'custom';

export interface Model {
  id: number;
  platform: Platform;
  modelId: string;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  sizeLabel: string;
  rpmLimit: number | null;
  rpdLimit: number | null;
  tpmLimit: number | null;
  tpdLimit: number | null;
  monthlyTokenBudget: string;
  contextWindow: number | null;
  enabled: boolean;
  supportsVision: boolean;
}

export type KeyStatus = 'healthy' | 'rate_limited' | 'invalid' | 'error' | 'unknown';

export interface ApiKey {
  id: number;
  platform: Platform;
  label: string;
  maskedKey: string;
  status: KeyStatus;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
}

export interface ApiKeyCreate {
  platform: Platform;
  key: string;
  label?: string;
}

// ---- Fallback Config ----

export interface FallbackEntry {
  modelId: number;
  platform: Platform;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  priority: number;
  enabled: boolean;
}

// ---- OpenAI-Compatible Types ----

export interface ChatToolCallFunction {
  name: string;
  arguments: string;
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: ChatToolCallFunction;
  thought_signature?: string;
}

export interface ChatToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatToolDefinition {
  type: 'function';
  function: ChatToolFunctionDefinition;
}

export type ChatToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
    type: 'function';
    function: {
      name: string;
    };
  };

// OpenAI's multimodal envelope: clients like opencode / continue.dev send
// content as an array of typed blocks even for text-only messages. We accept
// it on the wire and flatten to string for providers that don't support it
// (Cohere, Cloudflare). See server/src/lib/content.ts.
export type ChatContentBlock = { type: string; text?: string; [key: string]: unknown };
export type ChatContent = string | null | ChatContentBlock[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatContent;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
  _routed_via?: {
    platform: Platform;
    model: string;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string | null;
  }[];
}

// ---- Analytics Types ----

export interface AnalyticsSummary {
  totalRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  estimatedCostSavings: number;
}

export interface PlatformStats {
  platform: Platform;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface TimelinePoint {
  timestamp: string;
  requests: number;
  successCount: number;
  failureCount: number;
}

export interface RequestLog {
  id: number;
  platform: Platform;
  modelId: string;
  status: 'success' | 'error';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

// ---- Rate Limit Types ----

export interface RateLimitStatus {
  platform: Platform;
  modelId: string;
  rpm: { used: number; limit: number | null };
  rpd: { used: number; limit: number | null };
  tpm: { used: number; limit: number | null };
  available: boolean;
  nextResetAt: string | null;
}


// ---- Dynamic Provider Types ----

export interface ProviderAccountDto {
  id: number;
  provider: string;
  label: string;
  emailHint: string | null;
  status: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string | null;
  lastCheckedAt: string | null;
  credentialCount?: number;
  activeCredentialCount?: number;
  activeModelCount?: number;
}

export interface ProviderCredentialDto {
  id: number;
  providerAccountId: number;
  provider: string;
  label: string;
  baseUrl: string | null;
  status: string;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  maskedKeyPreview: string;
}

export interface DynamicModelDto {
  id: number;
  provider: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  deprecated: boolean;
  dynamic: boolean;
  discoveredSource: string;
  lastSeenAt: string | null;
  unavailableSince: string | null;
  contextWindow: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  rpmLimit: number | null;
  rpdLimit: number | null;
  tpmLimit: number | null;
  tpdLimit: number | null;
  monthlyTokenBudget: number | null;
  activeCredentialsCount?: number;
  healthyCredentialsCount?: number;
  totalEffectiveRpm?: number;
  totalEffectiveRpd?: number;
  totalEffectiveTpm?: number;
  totalEffectiveTpd?: number;
}

export interface DiscoverySummaryDto {
  providersChecked: number;
  accountsChecked: number;
  credentialsChecked: number;
  modelsAdded: number;
  modelsUpdated: number;
  modelsRemoved: number;
  modelsRestored: number;
  quotaChanges: number;
  metadataChanges: number;
  errors: number;
  startedAt: string;
  finishedAt: string;
}

export interface ModelChangeEventDto {
  id: number;
  provider: string;
  providerAccountId: number | null;
  modelId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface QuotaProfileDto {
  provider: string;
  modelId: string | null;
  rpmLimit: number | null;
  rpdLimit: number | null;
  tpmLimit: number | null;
  tpdLimit: number | null;
  monthlyTokenBudget: number | null;
  quotaScope: 'credential' | 'provider_account' | 'provider_global' | 'model' | 'unknown';
  source: 'manual' | 'provider_api' | 'inferred' | 'default';
  confidence: 'high' | 'medium' | 'low';
  updatedAt: string;
}

export interface CredentialHealthDto {
  provider: string;
  providerAccountId: number | null;
  credentialId: number | null;
  modelId: string | null;
  status: string;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface ProviderCapacityDto {
  provider: string;
  activeAccounts: number;
  activeCredentials: number;
  activeModels: number;
  deprecatedModels: number;
  newModels7d: number;
  removedModels30d: number;
  rpmLimitTotal: number | null;
  rpdLimitTotal: number | null;
  tpmLimitTotal: number | null;
  tpdLimitTotal: number | null;
  rpmUsedCurrentMinute: number;
  rpdUsedToday: number;
  tpmUsedCurrentMinute: number;
  tpdUsedToday: number;
  estimatedRemainingToday: number | null;
  estimatedMonthlyBudget: number | null;
}

export interface ProviderAnalyticsDto {
  provider: string;
  accounts: ProviderAccountDto[];
  credentials: ProviderCredentialDto[];
  models: DynamicModelDto[];
  capacity: ProviderCapacityDto;
  usage: any; // Add more specific type if needed
  health: CredentialHealthDto[];
  modelChanges: ModelChangeEventDto[];
}
