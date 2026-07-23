import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Zap, 
  RefreshCw, 
  Copy, 
  Check, 
  Layers, 
  Cpu, 
  ShieldCheck, 
  Radio, 
  Play, 
  Pause, 
  Search, 
  Network, 
  Eye, 
  Wrench,
  CheckCircle2,
} from 'lucide-react'
import mermaid from 'mermaid'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { buttonVariants } from '@/components/ui/button'

export interface QuotaPoolModel {
  id: number
  modelId: string
  displayName: string
  enabled: boolean
  supportsVision: boolean
  supportsTools: boolean
  contextWindow: number | null
  rpmLimit: number | null
  rpdLimit: number | null
  tpmLimit: number | null
  tpdLimit: number | null
}

export interface QuotaMetricState {
  metric: string
  limit: number | null
  remaining: number | null
  resetAt: string | null
  source: string
  confidence: number
  notes?: string | null
}

export interface QuotaPool {
  poolKey: string
  providerSlug: string
  providerDisplayName: string
  isShared: boolean
  activeKeyCount: number
  models: QuotaPoolModel[]
  quotaState: QuotaMetricState[]
}

// Initialize mermaid library
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#090d16',
    primaryColor: '#3b82f6',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#60a5fa',
    lineColor: '#64748b',
    secondaryColor: '#8b5cf6',
    tertiaryColor: '#10b981',
  },
  flowchart: {
    curve: 'basis',
    useMaxWidth: true,
  },
})

function generateMermaidMarkdown(pools: QuotaPool[]): string {
  let lines: string[] = ['flowchart TD']
  lines.push('  %% Router Entry')
  lines.push('  ClientRouter["⚡ FreeLLMAPI Unified Router"]:::routerStyle')
  lines.push('')

  const grouped = new Map<string, QuotaPool[]>()
  for (const pool of pools) {
    const list = grouped.get(pool.providerSlug) || []
    list.push(pool)
    grouped.set(pool.providerSlug, list)
  }

  let nodeCounter = 0
  for (const [providerSlug, providerPools] of grouped.entries()) {
    const providerName = providerPools[0]?.providerDisplayName || providerSlug
    const providerNodeId = `P_${providerSlug.replace(/[^a-zA-Z0-9]/g, '_')}`
    
    lines.push(`  ClientRouter --> ${providerNodeId}["🏢 Provider: ${providerName}"]:::providerStyle`)

    for (const pool of providerPools) {
      const poolNodeId = `Pool_${nodeCounter++}`
      const cleanPoolKey = pool.poolKey
      lines.push(`  ${providerNodeId} --> ${poolNodeId}["🏊 Quota Pool: ${cleanPoolKey}"]:::poolStyle`)

      for (const m of pool.models.slice(0, 6)) { // Keep diagram clean
        const modelNodeId = `M_${nodeCounter++}`
        const cleanModelName = m.displayName || m.modelId
        lines.push(`  ${poolNodeId} --> ${modelNodeId}["🤖 ${cleanModelName}"]:::modelStyle`)
      }
      if (pool.models.length > 6) {
        const moreNodeId = `M_more_${nodeCounter++}`
        lines.push(`  ${poolNodeId} --> ${moreNodeId}["+${pool.models.length - 6} More Models..."]:::moreStyle`)
      }
    }
    lines.push('')
  }

  lines.push('  classDef routerStyle fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#e0e7ff')
  lines.push('  classDef providerStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f0f9ff')
  lines.push('  classDef poolStyle fill:#14532d,stroke:#4ade80,stroke-width:2px,color:#f0fdf4')
  lines.push('  classDef modelStyle fill:#1e293b,stroke:#94a3b8,stroke-width:1px,color:#f8fafc')
  lines.push('  classDef moreStyle fill:#334155,stroke:#64748b,stroke-dasharray: 3 3,color:#cbd5e1')

  return lines.join('\n')
}

export default function QuotaPoolsPage() {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const [animating, setAnimating] = useState(true)
  const [activeTab, setActiveTab] = useState<'graph' | 'cards' | 'code'>('graph')
  const mermaidRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)

  const { data: pools = [], isLoading } = useQuery<QuotaPool[]>({
    queryKey: ['quota-pools'],
    queryFn: () => apiFetch<QuotaPool[]>('/api/providers/quota-pools'),
    refetchInterval: 15000,
  })

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; discovered: number; synced: number }>('/api/providers/discovery/run', { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(`Dynamic discovery completed: ${res.discovered} models updated across providers!`)
      queryClient.invalidateQueries({ queryKey: ['quota-pools'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Discovery sync failed')
    },
  })

  const mermaidMarkdown = useMemo(() => generateMermaidMarkdown(pools), [pools])

  // Render Mermaid Graph
  useEffect(() => {
    if (activeTab !== 'graph' || !mermaidRef.current || pools.length === 0) return

    let isMounted = true
    const renderGraph = async () => {
      try {
        const id = `mermaid-svg-${Date.now()}`
        const { svg } = await mermaid.render(id, mermaidMarkdown)
        if (isMounted && mermaidRef.current) {
          mermaidRef.current.innerHTML = svg
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
      }
    }

    renderGraph()
    return () => { isMounted = false }
  }, [mermaidMarkdown, activeTab, pools])

  const copyMermaidCode = () => {
    navigator.clipboard.writeText(mermaidMarkdown)
    setCopied(true)
    toast.success('Mermaid graph code copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredPools = useMemo(() => {
    if (!search.trim()) return pools
    const q = search.toLowerCase()
    return pools.filter(
      p => p.poolKey.toLowerCase().includes(q) ||
           p.providerDisplayName.toLowerCase().includes(q) ||
           p.models.some(m => m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q))
    )
  }, [pools, search])

  const totalModelsCount = useMemo(() => pools.reduce((acc, p) => acc + p.models.length, 0), [pools])

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950/60 p-6 sm:p-8 shadow-xl">
        <div className="absolute -right-12 -top-12 size-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 size-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400 backdrop-blur">
              <Zap className="size-3.5 animate-pulse text-blue-400" />
              Dynamic Pool Routing Architecture
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
              Quota Pools & Provider Routing
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              FreeLLMAPI routes requests dynamically without hardcoded limits. Models sharing upstream quota pools are tracked in real-time to prevent rate-limit depletion.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              <RefreshCw className={`mr-2 size-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync Provider Models'}
            </button>
            <button
              onClick={copyMermaidCode}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {copied ? <Check className="mr-2 size-4 text-emerald-400" /> : <Copy className="mr-2 size-4" />}
              {copied ? 'Copied!' : 'Copy Mermaid Code'}
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-800/80 pt-6 sm:grid-cols-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Layers className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-100">{pools.length}</div>
              <div className="text-xs text-slate-400">Quota Pools</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <Cpu className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-100">{totalModelsCount}</div>
              <div className="text-xs text-slate-400">LLM Models Pooled</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-100">Zero Hardcoding</div>
              <div className="text-xs text-slate-400">Dynamic Discovery</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <Radio className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-100">Live Pulse</div>
              <div className="text-xs text-slate-400">Animated Tracker</div>
            </div>
          </div>
        </div>
      </div>

      {/* View Switcher & Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border bg-slate-900/60 p-1 backdrop-blur">
          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-all ${
              activeTab === 'graph'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="size-3.5" />
            Animated Mermaid Graph
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-all ${
              activeTab === 'cards'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="size-3.5" />
            Quota Pool Cards ({filteredPools.length})
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-all ${
              activeTab === 'code'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Copy className="size-3.5" />
            Mermaid Diagram Code
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="Filter models or pools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900/80 pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* TAB 1: Animated Mermaid Graph View */}
      {activeTab === 'graph' && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between border-b border-slate-800/60 pb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 ${animating ? 'animate-ping' : ''} opacity-75`} />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Mermaid Routing Topology & Live Traffic Pulse
              </span>
            </div>

            <button
              onClick={() => setAnimating(!animating)}
              className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            >
              {animating ? <Pause className="size-3.5 text-amber-400" /> : <Play className="size-3.5 text-emerald-400" />}
              {animating ? 'Pause Routing Flow' : 'Play Routing Flow'}
            </button>
          </div>

          {/* Canvas animation overlay container */}
          <div ref={svgContainerRef} className="relative min-h-[450px] w-full overflow-x-auto p-4 flex justify-center">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center text-slate-400 text-sm">
                <RefreshCw className="mr-2 size-5 animate-spin text-blue-500" /> Rendering Mermaid graph...
              </div>
            ) : pools.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-slate-500 text-sm">
                No active quota pools found. Click "Sync Provider Models" to populate.
              </div>
            ) : (
              <div className="relative w-full max-w-5xl">
                <div ref={mermaidRef} className="mermaid-chart flex justify-center transition-opacity duration-300" />

                {/* Particle effect indicator banner overlay */}
                {animating && (
                  <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-slate-900/90 px-3 py-1.5 text-xs text-blue-300 backdrop-blur shadow-lg">
                    <span className="size-2 rounded-full bg-blue-400 animate-ping" />
                    Tracking live route connections dynamically
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Quota Pool Cards */}
      {activeTab === 'cards' && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
          {filteredPools.map((pool) => {
            const reqState = pool.quotaState.find(s => s.metric === 'requests')
            const tokState = pool.quotaState.find(s => s.metric === 'tokens')

            return (
              <div
                key={pool.poolKey}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur transition-all duration-200 hover:border-slate-700 hover:shadow-xl"
              >
                <div className="space-y-4">
                  {/* Top Bar */}
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-block rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
                        {pool.providerDisplayName}
                      </span>
                      <h3 className="mt-1 font-mono text-base font-bold text-slate-100">
                        {pool.poolKey}
                      </h3>
                    </div>
                    <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      {pool.activeKeyCount > 0 ? `${pool.activeKeyCount} Keys Connected` : 'Shared Pool'}
                    </span>
                  </div>

                  {/* Quota Metrics */}
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                    <div>
                      <div className="text-[11px] text-slate-400">Requests Quota</div>
                      <div className="text-sm font-semibold text-slate-200">
                        {reqState?.remaining != null ? `${reqState.remaining} remaining` : 'Dynamic / Header Tracked'}
                      </div>
                      {reqState?.limit && (
                        <div className="text-[10px] text-slate-500">Limit: {reqState.limit}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Tokens / Minute</div>
                      <div className="text-sm font-semibold text-slate-200">
                        {tokState?.remaining != null ? `${tokState.remaining} tpm` : 'Provider Managed'}
                      </div>
                      {tokState?.limit && (
                        <div className="text-[10px] text-slate-500">Limit: {tokState.limit}</div>
                      )}
                    </div>
                  </div>

                  {/* Pooled Models List */}
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-400">
                      Models Sharing This Pool ({pool.models.length}):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pool.models.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-800/50 px-2 py-1 text-xs text-slate-300"
                        >
                          <span>{m.displayName || m.modelId}</span>
                          {m.supportsVision && <span title="Vision Capable"><Eye className="size-3 text-blue-400" /></span>}
                          {m.supportsTools && <span title="Tool Calling Capable"><Wrench className="size-3 text-emerald-400" /></span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card footer */}
                <div className="mt-4 border-t border-slate-800/60 pt-3 text-[11px] text-slate-500">
                  Auto-failover enabled across pool instances
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TAB 3: Raw Mermaid Code View */}
      {activeTab === 'code' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Repository GFM Mermaid Graph Definition</h3>
            <button
              onClick={copyMermaidCode}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {copied ? <Check className="mr-2 size-4 text-emerald-400" /> : <Copy className="mr-2 size-4" />}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-xs text-blue-300">
            {mermaidMarkdown}
          </pre>
        </div>
      )}
    </div>
  )
}
