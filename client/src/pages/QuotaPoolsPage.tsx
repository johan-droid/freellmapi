import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Zap, 
  RefreshCw, 
  Copy, 
  Check, 
  Layers, 
  Cpu, 
  ShieldCheck, 
  Play, 
  Pause, 
  Search, 
  Network, 
  Eye, 
  Wrench,
  CheckCircle2,
  AlertCircle,
  Clock,
  Activity,
  Code2,
  Info,
  ChevronRight,
  Sparkles,
  Sliders
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
  healthStatus: 'healthy' | 'cooling_down' | 'degraded' | 'unusable'
  penaltyHits: number
  penaltyFactor: number
  cooldownExpiresInMs: number | null
  recentErrorCount: number
  recentErrors: Array<{ error: string; createdAt: string }>
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

// Initialize mermaid
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
  lines.push('  ClientRouter["⚡ FreeLLMAPI Unified Router"]:::routerStyle')

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
    
    lines.push(`  ClientRouter --> ${providerNodeId}["🏢 ${providerName}"]:::providerStyle`)

    for (const pool of providerPools) {
      const poolNodeId = `Pool_${nodeCounter++}`
      lines.push(`  ${providerNodeId} --> ${poolNodeId}["🏊 ${pool.poolKey}"]:::poolStyle`)

      for (const m of pool.models.slice(0, 5)) {
        const modelNodeId = `M_${nodeCounter++}`
        const cleanModelName = (m.displayName || m.modelId).replace(/["\n]/g, '')
        
        let styleClass = 'healthyStyle'
        if (m.healthStatus === 'cooling_down') styleClass = 'cooldownStyle'
        else if (m.healthStatus === 'degraded') styleClass = 'degradedStyle'
        else if (m.healthStatus === 'unusable') styleClass = 'unusableStyle'

        const statusIcon = m.healthStatus === 'healthy' ? '🟢' : m.healthStatus === 'cooling_down' ? '⏳' : m.healthStatus === 'degraded' ? '⚠️' : '⚪'
        lines.push(`  ${poolNodeId} --> ${modelNodeId}["${statusIcon} ${cleanModelName}"]:::${styleClass}`)
      }
    }
  }

  lines.push('  classDef routerStyle fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#e0e7ff')
  lines.push('  classDef providerStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f0f9ff')
  lines.push('  classDef poolStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#ecfdf5')
  lines.push('  classDef healthyStyle fill:#14532d,stroke:#22c55e,stroke-width:1px,color:#f0fdf4')
  lines.push('  classDef cooldownStyle fill:#78350f,stroke:#f59e0b,stroke-width:2px,color:#fef3c7')
  lines.push('  classDef degradedStyle fill:#7f1d1d,stroke:#ef4444,stroke-width:2px,color:#fef2f2')
  lines.push('  classDef unusableStyle fill:#1e293b,stroke:#475569,stroke-dasharray: 3 3,color:#94a3b8')

  return lines.join('\n')
}

export default function QuotaPoolsPage() {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const [animating, setAnimating] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false) // Default off to prevent annoying updates
  const [activeTab, setActiveTab] = useState<'visual' | 'graph' | 'compiler' | 'cards' | 'explanation'>('visual')
  const [selectedNode, setSelectedNode] = useState<{ type: 'provider' | 'pool' | 'model'; data: any } | null>(null)
  
  // Custom Mermaid Compiler Code state
  const [customMermaidCode, setCustomMermaidCode] = useState<string>('')
  const [compilerSvg, setCompilerSvg] = useState<string>('')
  const [compilerError, setCompilerError] = useState<string | null>(null)

  const mermaidRef = useRef<HTMLDivElement>(null)
  const lastRenderedCodeRef = useRef<string>('')

  const { data: pools = [] } = useQuery<QuotaPool[]>({
    queryKey: ['quota-pools'],
    queryFn: () => apiFetch<QuotaPool[]>('/api/providers/quota-pools'),
    refetchInterval: autoRefresh ? 30000 : false, // 30s if enabled, else manual only
  })

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; discovered: number; synced: number }>('/api/providers/discovery/run', { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(`Dynamic discovery completed: ${res.discovered} models updated across providers!`)
      queryClient.invalidateQueries({ queryKey: ['quota-pools'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Discovery sync failed')
    },
  })

  const mermaidMarkdown = useMemo(() => generateMermaidMarkdown(pools), [pools])

  // Set initial compiler code when pools load
  useEffect(() => {
    if (mermaidMarkdown && !customMermaidCode) {
      setCustomMermaidCode(mermaidMarkdown)
    }
  }, [mermaidMarkdown, customMermaidCode])

  // Stable Mermaid Graph Renderer (Only re-renders if diagram code actually changed)
  useEffect(() => {
    if (activeTab !== 'graph' || !mermaidRef.current || pools.length === 0) return
    if (lastRenderedCodeRef.current === mermaidMarkdown) return

    let isMounted = true
    const renderGraph = async () => {
      try {
        const id = `mermaid-svg-stable-${Date.now()}`
        const { svg } = await mermaid.render(id, mermaidMarkdown)
        if (isMounted && mermaidRef.current) {
          mermaidRef.current.innerHTML = svg
          lastRenderedCodeRef.current = mermaidMarkdown
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
      }
    }

    renderGraph()
    return () => { isMounted = false }
  }, [mermaidMarkdown, activeTab, pools])

  // Custom Mermaid Compiler Handler
  const compileCustomMermaid = useCallback(async (code: string) => {
    if (!code.trim()) return
    try {
      setCompilerError(null)
      const id = `mermaid-compiler-${Date.now()}`
      const { svg } = await mermaid.render(id, code)
      setCompilerSvg(svg)
    } catch (err: any) {
      setCompilerError(err?.message || 'Mermaid syntax error')
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'compiler' && customMermaidCode) {
      compileCustomMermaid(customMermaidCode)
    }
  }, [activeTab, customMermaidCode, compileCustomMermaid])

  const copyMermaidCode = () => {
    navigator.clipboard.writeText(customMermaidCode || mermaidMarkdown)
    setCopied(true)
    toast.success('Mermaid code copied to clipboard!')
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
  
  const healthStats = useMemo(() => {
    let healthy = 0, cooling = 0, degraded = 0, unusable = 0
    for (const p of pools) {
      for (const m of p.models) {
        if (m.healthStatus === 'healthy') healthy++
        else if (m.healthStatus === 'cooling_down') cooling++
        else if (m.healthStatus === 'degraded') degraded++
        else unusable++
      }
    }
    return { healthy, cooling, degraded, unusable }
  }, [pools])

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950/70 p-6 sm:p-8 shadow-2xl">
        <div className="absolute -right-12 -top-12 size-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-12 -bottom-12 size-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400 backdrop-blur">
              <Zap className="size-3.5 animate-pulse text-blue-400" />
              Dynamic Pool Routing & Deterioration Detection Engine
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
              Quota Pools & Model Health Inspector
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              FreeLLMAPI dynamically tracks provider rate-limit pools and detects model health degradation in real-time. Unusable or cooling-down models are automatically isolated while traffic routes smoothly through healthy pool members.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                autoRefresh
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="size-3.5" />
              {autoRefresh ? 'Auto-Refresh (30s)' : 'Auto-Refresh Off'}
            </button>
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

        {/* Health State Metrics Strip */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-800/80 pt-6 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-emerald-300">{healthStats.healthy}</div>
              <div className="text-[11px] text-slate-400">Healthy Models</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-950/20 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <Clock className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-amber-300">{healthStats.cooling}</div>
              <div className="text-[11px] text-slate-400">Cooling Down (429)</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-950/20 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-rose-300">{healthStats.degraded}</div>
              <div className="text-[11px] text-slate-400">Degraded / Penalized</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-900/40 p-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Cpu className="size-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-slate-300">{totalModelsCount}</div>
              <div className="text-[11px] text-slate-400">Total Models in {pools.length} Pools</div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tab Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap rounded-lg border border-slate-800 bg-slate-900/80 p-1 backdrop-blur">
          <button
            onClick={() => setActiveTab('visual')}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'visual'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="size-3.5" />
            Interactive Graph Compiler & Visualizer
          </button>

          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'graph'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="size-3.5" />
            Mermaid Topology
          </button>

          <button
            onClick={() => setActiveTab('compiler')}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'compiler'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="size-3.5" />
            Live Mermaid Compiler
          </button>

          <button
            onClick={() => setActiveTab('cards')}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'cards'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="size-3.5" />
            Pools & Models ({filteredPools.length})
          </button>

          <button
            onClick={() => setActiveTab('explanation')}
            className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-all ${
              activeTab === 'explanation'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Info className="size-3.5" />
            How Detection Engine Works
          </button>
        </div>

        <div className="relative w-full sm:w-64">
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

      {/* TAB 1: Real Interactive Canvas & Node Visualizer */}
      {activeTab === 'visual' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Live Quota Pool Network & Health State</h3>
                <p className="text-xs text-slate-400">Click any provider or model node to inspect its real-time rate limits, penalty score, and error logs.</p>
              </div>

              <button
                onClick={() => setAnimating(!animating)}
                className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                {animating ? <Pause className="size-3.5 text-amber-400" /> : <Play className="size-3.5 text-emerald-400" />}
                {animating ? 'Pause Flow' : 'Play Flow'}
              </button>
            </div>

            {/* Interactive Visual Graph Canvas */}
            <div className="relative min-h-[520px] overflow-y-auto space-y-6 pr-2">
              {/* Router Origin */}
              <div className="flex justify-center">
                <div 
                  onClick={() => setSelectedNode({ type: 'provider', data: { name: 'FreeLLMAPI Router', type: 'Router Core' } })}
                  className="cursor-pointer flex items-center gap-2 rounded-xl border border-indigo-500/50 bg-gradient-to-r from-indigo-950 to-slate-900 px-6 py-3 shadow-lg hover:border-indigo-400 transition"
                >
                  <Zap className="size-5 text-indigo-400 animate-pulse" />
                  <div>
                    <div className="text-xs font-bold text-indigo-200">⚡ FreeLLMAPI Unified Router</div>
                    <div className="text-[10px] text-indigo-400">Multi-Armed Bandit + Dynamic Quota Pool Balancer</div>
                  </div>
                </div>
              </div>

              {/* Provider & Model Clusters */}
              <div className="space-y-4">
                {filteredPools.map((pool) => (
                  <div key={pool.poolKey} className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
                    <div 
                      onClick={() => setSelectedNode({ type: 'pool', data: pool })}
                      className="flex cursor-pointer items-center justify-between border-b border-slate-800/60 pb-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-2 rounded-full bg-emerald-400" />
                        <span className="font-mono text-xs font-bold text-slate-200">{pool.providerDisplayName}</span>
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">{pool.poolKey}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <span>{pool.models.length} Models Pooled</span>
                        <ChevronRight className="size-3.5 text-slate-500" />
                      </div>
                    </div>

                    {/* Pooled Models Cards Grid */}
                    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {pool.models.map((m) => {
                        const isHealthy = m.healthStatus === 'healthy'
                        const isCooling = m.healthStatus === 'cooling_down'
                        const isDegraded = m.healthStatus === 'degraded'

                        return (
                          <div
                            key={m.id}
                            onClick={() => setSelectedNode({ type: 'model', data: { model: m, pool } })}
                            className={`group relative flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-all hover:scale-[1.01] ${
                              isHealthy
                                ? 'border-emerald-500/30 bg-emerald-950/10 hover:border-emerald-500/60'
                                : isCooling
                                ? 'border-amber-500/40 bg-amber-950/20 hover:border-amber-500/70'
                                : isDegraded
                                ? 'border-rose-500/40 bg-rose-950/20 hover:border-rose-500/70'
                                : 'border-slate-800 bg-slate-900/50 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${
                                isHealthy ? 'bg-emerald-400 animate-pulse' : isCooling ? 'bg-amber-400 animate-ping' : isDegraded ? 'bg-rose-500' : 'bg-slate-600'
                              }`} />
                              <div>
                                <div className="text-xs font-medium text-slate-200 group-hover:text-white">
                                  {m.displayName || m.modelId}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {isHealthy ? 'Routable & Healthy' : isCooling ? `Cooling down (${Math.round((m.cooldownExpiresInMs ?? 0)/1000)}s)` : isDegraded ? `Penalized (${m.penaltyHits} hits)` : 'Disabled'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {m.supportsVision && <span title="Vision Capable"><Eye className="size-3 text-blue-400" /></span>}
                              {m.supportsTools && <span title="Tool Calling Capable"><Wrench className="size-3 text-emerald-400" /></span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Node Inspector Side Panel */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <h3 className="mb-4 text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Sliders className="size-4 text-blue-400" />
              Node Inspector & Diagnostics
            </h3>

            {selectedNode ? (
              <div className="space-y-4 text-xs">
                {selectedNode.type === 'model' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                      <div className="font-bold text-slate-100 text-sm">{selectedNode.data.model.displayName}</div>
                      <div className="font-mono text-slate-400 text-[10px]">{selectedNode.data.model.modelId}</div>
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{
                        backgroundColor: selectedNode.data.model.healthStatus === 'healthy' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: selectedNode.data.model.healthStatus === 'healthy' ? '#34d399' : '#fbbf24',
                      }}>
                        {selectedNode.data.model.healthStatus}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2">
                      <div className="font-semibold text-slate-300">Penalty & Multi-Armed Bandit Factor</div>
                      <div className="flex justify-between text-slate-400">
                        <span>Penalty Hits:</span>
                        <span className="font-mono font-bold text-slate-200">{selectedNode.data.model.penaltyHits}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Rate Limit Score Multiplier:</span>
                        <span className="font-mono font-bold text-slate-200">{selectedNode.data.model.penaltyFactor.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Context Window:</span>
                        <span className="font-mono font-bold text-slate-200">{selectedNode.data.model.contextWindow ? `${selectedNode.data.model.contextWindow.toLocaleString()} tokens` : 'Standard'}</span>
                      </div>
                    </div>

                    {selectedNode.data.model.recentErrors?.length > 0 && (
                      <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 space-y-2">
                        <div className="font-semibold text-rose-300 flex items-center gap-1">
                          <AlertCircle className="size-3.5" /> Recent Diagnostic Logs
                        </div>
                        {selectedNode.data.model.recentErrors.map((err: any, idx: number) => (
                          <div key={idx} className="font-mono text-[10px] text-rose-400 border-t border-rose-900/40 pt-1.5">
                            {err.error}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.type === 'pool' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                      <div className="font-bold text-slate-100 text-sm">{selectedNode.data.providerDisplayName}</div>
                      <div className="font-mono text-emerald-400 text-xs mt-1">{selectedNode.data.poolKey}</div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2">
                      <div className="font-semibold text-slate-300">Pool Telemetry</div>
                      <div className="flex justify-between text-slate-400">
                        <span>Connected Keys:</span>
                        <span className="font-mono text-slate-200">{selectedNode.data.activeKeyCount}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Total Pooled Models:</span>
                        <span className="font-mono text-slate-200">{selectedNode.data.models.length}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center text-slate-500">
                <Sparkles className="mb-2 size-8 text-slate-600" />
                <p className="text-xs">Click any model card or provider pool on the left to inspect its live health telemetry and penalty state.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Stable Mermaid Topology */}
      {activeTab === 'graph' && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Mermaid System Flowchart (Stable Render)</h3>
              <p className="text-xs text-slate-400">Renders topology cleanly without unnecessary periodic page updates.</p>
            </div>
            <button
              onClick={copyMermaidCode}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Copy className="mr-2 size-4" /> Copy Mermaid Syntax
            </button>
          </div>

          <div className="min-h-[450px] w-full overflow-x-auto p-4 flex justify-center">
            <div ref={mermaidRef} className="mermaid-chart" />
          </div>
        </div>
      )}

      {/* TAB 3: Interactive Live Mermaid Code Compiler */}
      {activeTab === 'compiler' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Code2 className="size-4 text-blue-400" /> Mermaid Live Compiler Source
              </h3>
              <button
                onClick={() => compileCustomMermaid(customMermaidCode)}
                className={buttonVariants({ variant: 'default', size: 'sm' })}
              >
                Compile Graph
              </button>
            </div>

            <textarea
              value={customMermaidCode}
              onChange={(e) => {
                setCustomMermaidCode(e.target.value)
                compileCustomMermaid(e.target.value)
              }}
              rows={18}
              className="w-full flex-1 rounded-xl border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-blue-300 focus:border-blue-500 focus:outline-none"
            />

            {compilerError && (
              <div className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/30 p-3 font-mono text-xs text-rose-400">
                ⚠️ Compiler Error: {compilerError}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <h3 className="mb-4 border-b border-slate-800 pb-3 text-sm font-semibold text-slate-100">
              Compiled SVG Preview Output
            </h3>
            <div 
              className="mermaid-chart flex justify-center overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: compilerSvg }}
            />
          </div>
        </div>
      )}

      {/* TAB 4: Quota Pool Cards */}
      {activeTab === 'cards' && (
        <div className="grid gap-6 md:grid-cols-2">
          {filteredPools.map((pool) => (
            <div
              key={pool.poolKey}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
                      {pool.providerDisplayName}
                    </span>
                    <h3 className="mt-1 font-mono text-base font-bold text-slate-100">{pool.poolKey}</h3>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    {pool.activeKeyCount > 0 ? `${pool.activeKeyCount} Active Keys` : 'Shared Pool'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {pool.models.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-800/50 px-2.5 py-1 text-xs text-slate-300"
                    >
                      <span className={`size-1.5 rounded-full ${
                        m.healthStatus === 'healthy' ? 'bg-emerald-400' : m.healthStatus === 'cooling_down' ? 'bg-amber-400' : 'bg-rose-500'
                      }`} />
                      <span>{m.displayName || m.modelId}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 5: Technical Architecture & Deterioration Detection Explanation */}
      {activeTab === 'explanation' && (
        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl text-slate-300">
          <h2 className="text-lg font-bold text-slate-100 border-b border-slate-800 pb-3 flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-400" />
            FreeLLMAPI Provider Pool & Model Deterioration Engine Architecture
          </h2>

          <div className="grid gap-6 md:grid-cols-2 text-xs leading-relaxed">
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold text-blue-400">1. How Provider Quota Pools Are Managed</h3>
              <p>
                Upstream providers (such as Groq, Google, NVIDIA, OpenRouter, Cerebras, and Ollama) enforce rate limit buckets either per account key or across shared project pools.
              </p>
              <p>
                FreeLLMAPI uses <code className="font-mono text-emerald-400">inferQuotaPoolKey(platform, modelId)</code> to group all models that share the same underlying token/request pool. When any model in a pool receives rate-limit headers (e.g. <code className="font-mono text-slate-300">x-ratelimit-remaining-requests: 0</code> or <code className="font-mono text-slate-300">retry-after: 30</code>), the router marks the entire pool as cooling down.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold text-amber-400">2. How Deteriorating Models Are Detected</h3>
              <p>
                The Multi-Armed Bandit Scoring Engine (<code className="font-mono text-slate-300">scoring.ts</code>) continuously evaluates model health across three axes:
              </p>
              <ul className="list-disc space-y-1 pl-4 text-slate-400">
                <li><strong className="text-slate-200">Penalty Decay Factor:</strong> Consecutive 5xx or transport timeouts increase a model&apos;s penalty hits, decaying its score exponentially.</li>
                <li><strong className="text-slate-200">Automatic Circuit Breaker:</strong> The health worker checks keys every 5 minutes (<code className="font-mono text-slate-300">checkKeyHealth</code>). If a key fails 3 consecutive validation probes, it is auto-disabled.</li>
                <li><strong className="text-slate-200">Failover Rerouting:</strong> Deteriorated or cooling-down models are bypassed instantly in favor of healthy pool candidates.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
