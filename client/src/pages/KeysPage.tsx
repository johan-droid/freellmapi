import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UnifiedKeySection } from '@/components/UnifiedKeySection'
import { CustomProviderSection } from '@/components/CustomProviderSection'

// Mock registry based on old hardcoded lists. In full flow, ideally read from /api/providers
const PLATFORMS = [
  { value: 'openai', label: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
  { value: 'anthropic', label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
  { value: 'google', label: 'Google', url: 'https://aistudio.google.com/app/apikey' },
  { value: 'xai', label: 'xAI', url: 'https://console.x.ai/team/api-keys' },
  { value: 'groq', label: 'Groq', url: 'https://console.groq.com/keys' },
  { value: 'deepseek', label: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
  { value: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/settings/keys' },
  { value: 'together', label: 'Together', url: 'https://api.together.xyz/settings/api-keys' },
  { value: 'novita', label: 'Novita', url: 'https://novita.ai/dashboard/key' },
  { value: 'mistral', label: 'Mistral', url: 'https://console.mistral.ai/api-keys/' },
  { value: 'fireworks', label: 'Fireworks', url: 'https://fireworks.ai/account/api-keys' },
  { value: 'cerebras', label: 'Cerebras', url: 'https://cloud.cerebras.ai/platform/' },
  { value: 'cohere', label: 'Cohere', url: 'https://dashboard.cohere.com/api-keys' },
  { value: 'ai21', label: 'AI21', url: 'https://studio.ai21.com/account/api-key' },
  { value: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/settings/api' },
  { value: 'github', label: 'GitHub Models', url: 'https://github.com/settings/tokens' },
  { value: 'grok', label: 'Grok', url: 'https://console.x.ai/team/api-keys' },
  { value: 'cloudflare', label: 'Cloudflare', url: 'https://dash.cloudflare.com/profile/api-tokens' },
  { value: 'huggingface', label: 'Hugging Face', url: 'https://huggingface.co/settings/tokens' },
  { value: 'coze', label: 'Coze', url: 'https://www.coze.com/open/api' },
  { value: 'duckduckgo', label: 'DuckDuckGo', keyless: true, url: '' },
  { value: 'ollama', label: 'Ollama', url: '' },
  { value: 'koboldcpp', label: 'KoboldCPP', url: '' },
]

function GetKeyLink({ url }: { url: string }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline block mt-1">
      Get key →
    </a>
  )
}

const statusDot: Record<string, string> = {
  valid: 'bg-green-500',
  invalid: 'bg-red-500',
  rate_limited: 'bg-yellow-500',
  quota_exceeded: 'bg-orange-500',
  untested: 'bg-gray-400',
  unknown: 'bg-gray-400',
}

const statusLabel: Record<string, string> = {
  valid: 'Valid',
  invalid: 'Invalid key',
  rate_limited: 'Rate limited',
  quota_exceeded: 'Quota exceeded',
  untested: 'Untested',
  unknown: 'Unknown',
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<string>('')
  const [accountId, setAccountId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState('')
  const [accountEmailHint, setAccountEmailHint] = useState('')

  const [editingKeyId, setEditingKeyId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Use new provider-accounts and provider-credentials endpoints
  const { data: accounts = [], isLoading: isLoadingAccounts } = useQuery<any[]>({
    queryKey: ['provider-accounts'],
    queryFn: () => apiFetch('/api/admin/provider-accounts'),
  })

  const { data: credentials = [] } = useQuery<any[]>({
    queryKey: ['provider-credentials'],
    queryFn: () => apiFetch('/api/admin/provider-credentials'),
  })

  // We map legacy endpoints to new provider hierarchy (this requires backend to support /provider-accounts/POST)
  const addAccountAndKey = useMutation({
    mutationFn: async ({ platform, key, label, emailHint }: any) => {
      // 1. Create Account
      const account = await apiFetch('/api/admin/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({ provider: platform, label, emailHint, enabled: true })
      });
      // 2. Create Credential
      await apiFetch(`/api/admin/provider-accounts/${(account as any).id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: key, label: label + ' Key' })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
      setApiKey('')
      setLabel('')
      setAccountEmailHint('')
      setAccountId('')
    },
  })

  const checkKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/provider-credentials/${id}/check`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/provider-credentials/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    },
  })

  const updateKey = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) =>
      apiFetch(`/api/admin/provider-credentials/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
      setEditingKeyId(null)
      setEditingLabel('')
    },
  })

  const toggleAccount = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch(`/api/admin/provider-accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provider-accounts'] }),
  })

  function startEditing(cred: any) {
    setEditingKeyId(cred.id)
    setEditingLabel(cred.label || '')
  }

  function cancelEditing() {
    setEditingKeyId(null)
    setEditingLabel('')
  }

  function saveEditing(id: number) {
    if (editingLabel !== undefined) {
      updateKey.mutate({ id, label: editingLabel })
    }
  }

  useEffect(() => {
    if (editingKeyId !== null && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingKeyId])

  const needsAccountId = platform === 'cloudflare'
  const isKeyless = PLATFORMS.find(p => p.value === platform)?.keyless ?? false

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform) return
    if (!isKeyless && !apiKey) return
    if (needsAccountId && !accountId) return
    const key = isKeyless ? '' : (needsAccountId ? `${accountId}:${apiKey}` : apiKey)
    addAccountAndKey.mutate({ platform, key, label: label || undefined, emailHint: accountEmailHint || undefined })
  }

  // Group accounts by provider for UI display
  const providersMap = new Map();
  accounts.forEach(acc => {
    if (!providersMap.has(acc.provider)) providersMap.set(acc.provider, []);
    providersMap.get(acc.provider).push(acc);
  });

  return (
    <div>
      <PageHeader
        title="Provider Accounts & Credentials"
        description="Manage your provider accounts, API keys, and routing credentials."
      />

      <div className="space-y-8 mt-4">
        <UnifiedKeySection />

        <section>
          <h2 className="text-sm font-medium mb-3">Add a provider credential</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-xl border p-4 bg-card/70 backdrop-blur-md">
            <div className="space-y-1.5 w-full sm:w-auto">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as string)}>
                <SelectTrigger className="w-full sm:w-[220px] rounded-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const sel = PLATFORMS.find(p => p.value === platform)
                return sel?.url ? <div className="pt-0.5"><GetKeyLink url={sel.url} /></div> : null
              })()}
            </div>

            <div className="space-y-1.5 w-full sm:w-auto">
              <Label className="text-xs">Account Label</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Personal, Work"
                className="w-full sm:w-[160px] rounded-full"
              />
            </div>

            <div className="space-y-1.5 w-full sm:w-auto">
              <Label className="text-xs">Email Hint</Label>
              <Input
                value={accountEmailHint}
                onChange={e => setAccountEmailHint(e.target.value)}
                placeholder="john@example.com"
                className="w-full sm:w-[160px] rounded-full"
              />
            </div>

            {needsAccountId && (
              <div className="space-y-1.5 w-full sm:w-auto">
                <Label className="text-xs">Account ID</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="a1b2c3d4…"
                  className="w-full sm:w-[200px] font-mono text-xs rounded-full"
                />
              </div>
            )}
            <div className="space-y-1.5 w-full sm:flex-1 sm:min-w-[240px]">
              <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
              <Input
                type="password"
                value={isKeyless ? '' : apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={isKeyless ? 'No API key needed' : (needsAccountId ? 'Bearer token' : 'paste key here')}
                className="font-mono text-xs rounded-full"
                disabled={isKeyless}
              />
            </div>

            <Button type="submit" size="sm" className="w-full sm:w-auto rounded-full" disabled={!platform || (!isKeyless && !apiKey) || (needsAccountId && !accountId) || addAccountAndKey.isPending}>
              {addAccountAndKey.isPending ? 'Adding…' : isKeyless ? 'Enable' : 'Add Credential'}
            </Button>
          </form>
          {addAccountAndKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addAccountAndKey.error as Error).message}</p>
          )}
        </section>

        <CustomProviderSection />

        <section>
          <h2 className="text-sm font-medium mb-3">Configured Accounts</h2>
          {isLoadingAccounts ? (
            <p className="text-sm text-muted-foreground animate-pulse">Loading accounts…</p>
          ) : accounts.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-8 text-center bg-card/50">
              <p className="text-sm text-muted-foreground">
                No provider accounts yet. Add one above to start routing.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(providersMap.entries()).map(([provider, providerAccounts]) => (
                <div key={provider} className="rounded-3xl border bg-card/70 backdrop-blur-md overflow-hidden">
                  <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-between">
                    <h3 className="font-semibold text-lg">{provider}</h3>
                    <span className="text-xs text-muted-foreground">
                      {providerAccounts.length} Account{providerAccounts.length !== 1 && 's'}
                    </span>
                  </div>

                  <div className="divide-y divide-border/50">
                    {providerAccounts.map((acc: any) => {
                      const accCreds = credentials.filter(c => c.providerAccountId === acc.id);
                      return (
                        <div key={acc.id} className="p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={acc.enabled}
                                onCheckedChange={(checked) =>
                                  toggleAccount.mutate({ id: acc.id, enabled: checked })
                                }
                                disabled={toggleAccount.isPending}
                              />
                              <div>
                                <h4 className="font-medium text-sm">{acc.label || 'Default Account'}</h4>
                                {acc.emailHint && <p className="text-xs text-muted-foreground">{acc.emailHint}</p>}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {accCreds.length} Credentials
                            </div>
                          </div>

                          {/* Credentials list for this account */}
                          {accCreds.length > 0 && (
                            <div className="rounded-xl border bg-card overflow-hidden">
                              {accCreds.map(k => {
                                const status = k.status || 'unknown'
                                const isEditing = editingKeyId === k.id
                                return (
                                  <div key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b last:border-0">
                                    <span className={`size-2 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
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
                                        className="h-8 w-full sm:w-[160px] text-xs rounded-full"
                                        disabled={updateKey.isPending}
                                      />
                                    ) : (
                                      <span className="text-sm font-medium">{k.label || 'Unnamed Credential'}</span>
                                    )}
                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{statusLabel[status] ?? status}</span>

                                    <div className="flex-1 hidden sm:block" />

                                    {!isEditing && (
                                      <Button variant="ghost" size="sm" onClick={() => startEditing(k)} className="rounded-full">
                                        <Pencil className="size-3" />
                                      </Button>
                                    )}
                                    <Button variant="ghost" size="sm" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending} className="rounded-full">
                                      Test
                                    </Button>
                                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive rounded-full" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                                      Remove
                                    </Button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
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
