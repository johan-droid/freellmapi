import type { ApiKeyModel, Platform, ProviderQuotaState } from '../../../../shared/types'
import { ExternalLink } from 'lucide-react'
import { useI18n } from '@/i18n'

// Small "Get API key" external link shown next to a provider (#137).
export function GetKeyLink({ url }: { url: string }) {
  const { t } = useI18n()
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {t('keys.getApiKey')}
      <ExternalLink className="size-3" />
    </a>
  )
}

// `url` points to each provider's key-management / signup page so the Keys page
// can show a "Get API key" shortcut (#137). OpenCode Zen's key is free from
// opencode.ai/auth — no card needed; billing only applies to paid models (#128).
// `keyless: true` providers (Kilo's anonymous free tier) need no API key — the
// form disables the key field and submits a sentinel the backend stores so
// routing treats the platform as configured.
export const PLATFORMS: { value: Platform; label: string; url: string; keyless?: boolean }[] = [
  { value: 'openai', label: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
  { value: 'anthropic', label: 'Anthropic Claude', url: 'https://console.anthropic.com/settings/keys' },
  { value: 'google', label: 'Google AI Studio', url: 'https://aistudio.google.com/app/apikey' },
  { value: 'groq', label: 'Groq', url: 'https://console.groq.com/keys' },
  { value: 'cerebras', label: 'Cerebras', url: 'https://cloud.cerebras.ai/platform/keys' },
  { value: 'sambanova', label: 'SambaNova', url: 'https://cloud.sambanova.ai/apis' },
  { value: 'fireworks', label: 'Fireworks AI', url: 'https://fireworks.ai/account/api-keys' },
  { value: 'together', label: 'Together AI', url: 'https://api.together.xyz/settings/api-keys' },
  { value: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys' },
  { value: 'github', label: 'GitHub Models', url: 'https://github.com/settings/tokens' },
  { value: 'mistral', label: 'Mistral AI', url: 'https://console.mistral.ai/api-keys' },
  { value: 'nvidia', label: 'NVIDIA NIM', url: 'https://build.nvidia.com/explore/discover' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI', url: 'https://dash.cloudflare.com/profile/api-tokens' },
  { value: 'huggingface', label: 'HuggingFace Router', url: 'https://huggingface.co/settings/tokens' },
  { value: 'replicate', label: 'Replicate', url: 'https://replicate.com/account/api-tokens' },
  { value: 'ai21', label: 'AI21 Labs', url: 'https://studio.ai21.com/account/account' },
  { value: 'cohere', label: 'Cohere', url: 'https://dashboard.cohere.com/api-keys' },
  { value: 'friendli', label: 'FriendliAI', url: 'https://suite.friendli.ai/team/tokens' },
  { value: 'featherless', label: 'Featherless AI', url: 'https://featherless.ai/dashboard' },
  { value: 'baseten', label: 'Baseten', url: 'https://app.baseten.co/settings/api_keys' },
  { value: 'deepinfra', label: 'DeepInfra', url: 'https://deepinfra.com/dash/api_keys' },
  { value: 'aws_bedrock', label: 'AWS Bedrock', url: 'https://console.aws.amazon.com/iam/home#/users' },
  { value: 'google_vertex', label: 'Google Vertex AI', url: 'https://console.cloud.google.com/iam-admin/serviceaccounts' },
  { value: 'azure', label: 'Azure OpenAI', url: 'https://portal.azure.com' },
  { value: 'watsonx', label: 'IBM watsonx', url: 'https://cloud.ibm.com/iam/apikeys' },
  { value: 'scaleway', label: 'Scaleway', url: 'https://console.scaleway.com/iam/api-keys' },
  { value: 'ollama_local', label: 'Ollama Local (http://localhost:11434)', url: 'https://ollama.com', keyless: true },
  { value: 'lmstudio', label: 'LM Studio (http://localhost:1234)', url: 'https://lmstudio.ai', keyless: true },
  { value: 'llamacpp', label: 'llama.cpp (http://localhost:8080)', url: 'https://github.com/ggerganov/llama.cpp', keyless: true },
  { value: 'vllm', label: 'vLLM Engine (http://localhost:8000)', url: 'https://docs.vllm.ai', keyless: true },
  { value: 'hyperbolic', label: 'Hyperbolic', url: 'https://app.hyperbolic.xyz' },
  { value: 'lambda', label: 'Lambda AI', url: 'https://cloud.lambdalabs.com/api-keys' },
  { value: 'nebius', label: 'Nebius AI Studio', url: 'https://studio.nebius.ai' },
  { value: 'nscale', label: 'nScale', url: 'https://nscale.com' },
  { value: 'nous', label: 'Nous Research', url: 'https://nousresearch.com' },
  { value: 'llama_api', label: 'Meta Llama API', url: 'https://llama.com' },
  { value: 'perplexity', label: 'Perplexity AI', url: 'https://www.perplexity.ai/settings/api' },
  { value: 'xai', label: 'xAI (Grok)', url: 'https://console.x.ai' },
  { value: 'liquid', label: 'Liquid AI', url: 'https://labs.liquid.ai' },
  { value: 'upstage', label: 'Upstage Solar', url: 'https://console.upstage.ai' },
  { value: 'morph', label: 'Morph Labs', url: 'https://morphlabs.ai' },
  { value: 'jina', label: 'Jina AI', url: 'https://jina.ai' },
  { value: 'voyage', label: 'Voyage AI', url: 'https://dash.voyageai.com' },
  { value: 'nomic', label: 'Nomic AI', url: 'https://atlas.nomic.ai' },
  { value: 'bai', label: 'B.AI (promotional free model)', url: 'https://b.ai' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)', url: 'https://z.ai/manage-apikey/apikey-list' },
  { value: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com/settings/keys' },
  { value: 'kilo', label: 'Kilo Gateway (no key needed)', url: 'https://app.kilo.ai', keyless: true },
  { value: 'pollinations', label: 'Pollinations', url: 'https://enter.pollinations.ai' },
  { value: 'ovh', label: 'OVH AI Endpoints (no key needed)', url: 'https://endpoints.ai.cloud.ovh.net', keyless: true },
  { value: 'llm7', label: 'LLM7 (anon ok)', url: 'https://llm7.io' },
  { value: 'opencode', label: 'OpenCode Zen (free key)', url: 'https://opencode.ai/auth' },
  { value: 'agnes', label: 'Agnes AI (free key)', url: 'https://platform.agnes-ai.com' },
  { value: 'reka', label: 'Reka (free key)', url: 'https://platform.reka.ai' },
  { value: 'siliconflow', label: 'SiliconFlow (image + TTS)', url: 'https://siliconflow.com' },
  { value: 'routeway', label: 'Routeway (free key)', url: 'https://routeway.ai' },
  { value: 'bazaarlink', label: 'BazaarLink (free key)', url: 'https://bazaarlink.ai' },
  { value: 'ainative', label: 'AINative Studio (free key)', url: 'https://ainative.studio' },
  { value: 'aion', label: 'Aion Labs (free key)', url: 'https://www.aionlabs.ai' },
  { value: 'requesty', label: 'Requesty (free key)', url: 'https://www.requesty.ai' },
  { value: 'navy', label: 'NavyAI (free key)', url: 'https://api.navy' },
  { value: 'nara', label: 'NaraRouter (free key)', url: 'https://router.bynara.id' },
  { value: 'sealion', label: 'SEA-LION (free key)', url: 'https://sea-lion.ai' },
  { value: 'orcarouter', label: 'OrcaRouter (free key)', url: 'https://www.orcarouter.ai' },
  { value: 'unorouter', label: 'UnoRouter (free key)', url: 'https://unorouter.com' },
  { value: 'xkiro', label: 'xKiro (free key)', url: 'https://xkiro.com' },
  { value: 'anyapi', label: 'AnyAPI (free key)', url: 'https://anyapi.ai' },
  { value: 'modelscope', label: 'ModelScope (free key, needs Aliyun cn binding)', url: 'https://modelscope.cn/my/myaccesstoken' },
]

// 'custom' is configured through its own form (base URL + model), not the
// generic key dropdown — but it still appears in the grouped provider list.
export const CUSTOM_GROUP: { value: Platform; label: string; url: string } = {
  value: 'custom',
  label: 'Custom (OpenAI-compatible)',
  url: '',
}

export const CUSTOM_MODEL_KIND_LABEL: Record<ApiKeyModel['kind'], string> = {
  chat: 'keys.customTypeChat',
  embedding: 'keys.customTypeEmbedding',
  image: 'keys.customTypeImage',
  audio: 'keys.customTypeAudio',
  transcription: 'keys.customTypeTranscription',
}

export function customModelDeleteKey(model: ApiKeyModel): string {
  return `${model.kind}:${model.id}`
}

export function customModelDeletePath(model: ApiKeyModel): string {
  if (model.kind === 'chat') return `/api/models/custom/${model.id}`
  if (model.kind === 'embedding') return `/api/embeddings/custom/${model.id}`
  return `/api/media/custom/${model.id}`
}

export const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

export const statusLabelKey: Record<string, string> = {
  healthy: 'status.healthy',
  rate_limited: 'status.rateLimited',
  invalid: 'status.invalid',
  error: 'status.error',
  unknown: 'status.unchecked',
}

export interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

export interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null; lastHealthError: string | null }[]
  quotaStates: ProviderQuotaState[]
}
