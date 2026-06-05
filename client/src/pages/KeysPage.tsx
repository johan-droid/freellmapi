import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'
import type { ApiKey, Platform } from '../../../shared/types'
import { Pencil, ExternalLink } from 'lucide-react'
import { formatSqliteUtcToLocalTime } from '@/lib/utils'

function GetKeyLink({ url }: { url: string }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      Get API key
      <ExternalLink className="size-3" />
    </a>
  )
}

const PLATFORMS: { value: Platform; label: string; url: string; keyless?: boolean }[] = [
  { value: 'google', label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  { value: 'groq', label: 'Groq', url: 'https://console.groq.com/keys' },
  { value: 'cerebras', label: 'Cerebras', url: 'https://cloud.cerebras.ai' },
  { value: 'sambanova', label: 'SambaNova', url: 'https://cloud.sambanova.ai' },
  { value: 'nvidia', label: 'NVIDIA NIM', url: 'https://build.nvidia.com/settings/api-keys' },
  { value: 'mistral', label: 'Mistral', url: 'https://console.mistral.ai/api-keys/' },
  { value: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys' },
  { value: 'github', label: 'GitHub Models', url: 'https://github.com/settings/tokens' },
  { value: 'cohere', label: 'Cohere', url: 'https://dashboard.cohere.com/api-keys' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI', url: 'https://dash.cloudflare.com' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)', url: 'https://z.ai/manage-apikey/apikey-list' },
  { value: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com/settings/keys' },
  { value: 'kilo', label: 'Kilo Gateway (no key needed)', url: 'https://app.kilo.ai', keyless: true },
  { value: 'pollinations', label: 'Pollinations (anon ok)', url: 'https://pollinations.ai' },
  { value: 'llm7', label: 'LLM7 (anon ok)', url: 'https://llm7.io' },
  { value: 'huggingface', label: 'HuggingFace Router', url: 'https://huggingface.co/settings/tokens' },
  { value: 'opencode', label: 'OpenCode Zen (free key)', url: 'https://opencode.ai/auth' },
]

const CUSTOM_GROUP: { value: Platform; label: string; url: string } = {
  value: 'custom',
  label: 'Custom (OpenAI-compatible)',
  url: '',
}

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: 'healthy',
  rate_limited: 'rate-limited',
  invalid: 'invalid',
  error: 'error',
  unknown: 'unchecked',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [revealedKey, setRevealedKey] = useState('')
  const [copied, setCopied] = useState(false)

  const { data, isError } = useQuery<{ maskedKey: string; prefix: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const reveal = useMutation<{ apiKey: string }>({
    mutationFn: () => apiFetch('/api/settings/api-key/reveal', { method: 'POST' }),
    onSuccess: (payload) => setRevealedKey(payload.apiKey),
  })

  const regenerate = useMutation<{ apiKey: string; maskedKey: string }>({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: (payload) => {
      setRevealedKey(payload.apiKey)
      queryClient.invalidateQueries({ queryKey: ['unified-key'] })
    },
  })

  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`

  async function copy() {
    const key = revealedKey || (await reveal.mutateAsync()).apiKey
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-3xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Your unified API key</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use this as your OpenAI <code className="font-mono">api_key</code>. The full key is revealed only on demand.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending || isError}
        >
          {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
        </Button>
      </div>

      {isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          Can't reach the server on <code className="font-mono break-all">{baseUrl.replace('/v1', '')}</code>. Make sure the backend is running.
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs tabular-nums">
            {revealedKey || data?.maskedKey || '…'}
          </code>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" size="sm" onClick={() => revealedKey ? setRevealedKey('') : reveal.mutate()} disabled={reveal.isPending}>
              {revealedKey ? 'Hide' : reveal.isPending ? 'Revealing…' : 'Reveal'}
            </Button>
            <Button variant="outline" size="sm" onClick={copy} disabled={reveal.isPending}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-1.5">
        <span className="text-muted-foreground">Base URL</span>
        <code className="overflow-x-auto font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Chat</span>
        <code className="overflow-x-auto font-mono">/v1/chat/completions</code>
        <span className="text-muted-foreground">Responses</span>
        <code className="overflow-x-auto font-mono">/v1/responses</code>
        <span className="text-muted-foreground">Embeddings</span>
        <code className="overflow-x-auto font-mono">/v1/embeddings</code>
      </div>
    </section>
  )
}

function CustomProviderSection() {
  const queryClient = useQueryClient()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')

  const addCustom = useMutation({
    mutationFn: (body: { baseUrl: string; model: string; displayName?: string; apiKey?: string }) =>
      apiFetch('/api/keys/custom', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setModel('')
      setDisplayName('')
      setApiKey('')
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!baseUrl || !model) return
    addCustom.mutate({ baseUrl, model, displayName: displayName || undefined, apiKey: apiKey || undefined })
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium">Add a custom OpenAI-compatible model</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Point at any OpenAI-compatible endpoint. The API key is optional for local servers.
      </p>
      <form onSubmit={submit} className="grid gap-3 rounded-3xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_180px_160px_160px_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Base URL</Label>
          <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1" className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Input value={model} onChange={e => setModel(e.target.value)} placeholder="qwen3:4b" className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Display name</Label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">API key</Label>
          <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="optional" className="font-mono text-xs" autoComplete="off" />
        </div>
        <Button type="submit" size="sm" className="w-full lg:w-auto" disabled={!baseUrl || !model || addCustom.isPending}>
          {addCustom.isPending ? 'Adding…' : 'Add model'}
        </Button>
      </form>
      {addCustom.isError && <p className="mt-2 text-xs text-destructive">{(addCustom.error as Error).message}</p>}
    </section>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({ queryKey: ['keys'], queryFn: () => apiFetch('/api/keys') })
  const { data: healthData } = useQuery<HealthData>({ queryKey: ['health'], queryFn: () => apiFetch('/api/health'), refetchInterval: 30000 })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) => apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const togglePlatform = useMutation({
    mutationFn: ({ platform, enabled }: { platform: string; enabled: boolean }) => apiFetch(`/api/keys/platform/${platform}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
    },
  })

  const updateKey = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => apiFetch(`/api/keys/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      setEditingKeyId(null)
      setEditingLabel('')
    },
  })

  function startEditing(key: ApiKey) {
    setEditingKeyId(key.id)
    setEditingLabel(key.label)
  }

  function cancelEditing() {
    setEditingKeyId(null)
    setEditingLabel('')
  }

  function saveEditing(id: number) {
    updateKey.mutate({ id, label: editingLabel })
  }

  useEffect(() => {
    if (editingKeyId !== null && editInputRef.current) editInputRef.current.focus()
  }, [editingKeyId])

  const needsAccountId = platform === 'cloudflare'
  const isKeyless = PLATFORMS.find(p => p.value === platform)?.keyless ?? false

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform) return
    if (!isKeyless && !apiKey) return
    if (needsAccountId && !accountId) return
    const key = isKeyless ? '' : (needsAccountId ? `${accountId}:${apiKey}` : apiKey)
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = [...PLATFORMS, CUSTOM_GROUP]
    .map(p => ({ ...p, keys: keys.filter(k => k.platform === p.value) }))
    .filter(p => p.keys.length > 0)

  return (
    <div className="min-w-0">
      <PageHeader
        title="Keys"
        description="Provider credentials and the unified API key your apps connect with."
        actions={keys.length > 0 && (
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
            {checkAll.isPending ? 'Checking…' : 'Check all'}
          </Button>
        )}
      />

      <div className="space-y-8">
        <UnifiedKeySection />

        <section>
          <h2 className="mb-3 text-sm font-medium">Add a provider key</h2>
          <form onSubmit={handleSubmit} className="grid gap-3 rounded-3xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[220px_200px_minmax(240px,1fr)_240px]">
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>{PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              {(() => {
                const sel = PLATFORMS.find(p => p.value === platform)
                return sel?.url ? <div className="pt-0.5"><GetKeyLink url={sel.url} /></div> : null
              })()}
            </div>
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Account ID</Label>
                <Input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="a1b2c3d4…" className="font-mono text-xs" autoComplete="off" />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
              <Input
                type="password"
                value={isKeyless ? '' : apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={isKeyless ? 'No API key needed' : (needsAccountId ? 'Bearer token' : 'paste key here')}
                className="font-mono text-xs"
                disabled={isKeyless}
                autoComplete="off"
              />
              {isKeyless && <p className="text-[11px] text-muted-foreground">No API key needed — this provider is anonymous and rate-limited per IP.</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label className="text-xs">Label</Label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="optional" />
                <Button type="submit" size="sm" disabled={!platform || (!isKeyless && !apiKey) || (needsAccountId && !accountId) || addKey.isPending}>
                  {addKey.isPending ? 'Adding…' : isKeyless ? 'Enable' : 'Add key'}
                </Button>
              </div>
            </div>
          </form>
          {addKey.isError && <p className="mt-2 text-xs text-destructive">{(addKey.error as Error).message}</p>}
        </section>

        <CustomProviderSection />

        <section>
          <h2 className="mb-3 text-sm font-medium">Configured providers</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No provider keys yet. Add one above to start routing.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => (
                <div key={group.value} className="min-w-0">
                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <Switch checked={group.keys.some(k => k.enabled)} onCheckedChange={(checked) => togglePlatform.mutate({ platform: group.value, enabled: checked })} disabled={togglePlatform.isPending} />
                      <h3 className="truncate text-sm font-medium">{group.label}</h3>
                      <GetKeyLink url={group.url} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">{group.keys.length} key{group.keys.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border bg-card sm:divide-y">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      const isEditing = editingKeyId === k.id
                      return (
                        <div key={k.id} className="grid gap-3 border-b px-4 py-3 last:border-b-0 sm:flex sm:items-center sm:border-b-0 sm:hover:bg-muted/40">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={`size-1.5 shrink-0 rounded-full ${statusDot[status] ?? statusDot.unknown}`} />
                            <code className="min-w-0 truncate font-mono text-xs">{k.maskedKey}</code>
                            <span className="shrink-0 text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
                          </div>
                          {isEditing ? (
                            <Input
                              ref={editInputRef}
                              value={editingLabel}
                              onChange={e => setEditingLabel(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEditing(k.id)
                                if (e.key === 'Escape') cancelEditing()
                              }}
                              onBlur={() => saveEditing(k.id)}
                              className="h-8 text-xs sm:w-[180px]"
                              disabled={updateKey.isPending}
                            />
                          ) : k.label ? (
                            <span className="min-w-0 truncate text-xs text-muted-foreground">{k.label}</span>
                          ) : null}
                          <div className="hidden flex-1 sm:block" />
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            {lastChecked && <span className="text-[11px] text-muted-foreground tabular-nums">{formatSqliteUtcToLocalTime(lastChecked, { hour: '2-digit', minute: '2-digit' })}</span>}
                            {!isEditing && <Button variant="ghost" size="xs" onClick={() => startEditing(k)}><Pencil className="size-3" /></Button>}
                            <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>Check</Button>
                            <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>Remove</Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
