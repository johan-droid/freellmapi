import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Zap, 
  RefreshCw, 
  Copy, 
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
import { PageHeader } from '@/components/page-header'
import { ModelsTabs } from '@/components/models-tabs'
import { Tooltip } from '@/components/tooltip'

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
  const [search, setSearch] = useState('')
  const [animating, setAnimating] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
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
    refetchInterval: autoRefresh ? 30000 : false,
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

  // Stable Mermaid Graph Renderer
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
    toast.success('Mermaid code copied to clipboard!')
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
    <div className="space-y-6">
      {/* Integrated Native Page Header */}
      <PageHeader
        title="Quota Pools & Routing"
        description="Monitor provider quota pools, track rate-limit statuses, and inspect multi-armed bandit penalties in real-time."
        divider={false}
        actions={<ModelsTabs />}
      />

      {/* Top Health Analytics strip matching rest of UI dashboard layout */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">{healthStats.healthy}</div>
            <div className="text-[11px] text-muted-foreground">Healthy Models</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Clock className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">{healthStats.cooling}</div>
            <div className="text-[11px] text-muted-foreground">Cooling Down (429)</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertCircle className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">{healthStats.degraded}</div>
            <div className="text-[11px] text-muted-foreground">Degraded / Penalized</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Cpu className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-foreground">{totalModelsCount}</div>
            <div className="text-[11px] text-muted-foreground">Total Models</div>
          </div>
        </div>
      </div>

      {/* Sub Toolbar & View Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border p-1 bg-muted/40">
          <button
            onClick={() => setActiveTab('visual')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'visual'
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Activity className="mr-1.5 inline size-3.5" />
            Interactive Network
          </button>

          <button
            onClick={() => setActiveTab('graph')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'graph'
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Network className="mr-1.5 inline size-3.5" />
            Mermaid Topology
          </button>

          <button
            onClick={() => setActiveTab('compiler')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'compiler'
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Code2 className="mr-1.5 inline size-3.5" />
            Mermaid Compiler
          </button>

          <button
            onClick={() => setActiveTab('cards')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'cards'
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Layers className="mr-1.5 inline size-3.5" />
            Pools list
          </button>

          <button
            onClick={() => setActiveTab('explanation')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'explanation'
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Info className="mr-1.5 inline size-3.5" />
            Engine Architecture
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search pools or models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56 rounded-lg border bg-background pl-9 pr-4 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <Tooltip text="Manually trigger background model sync and discovery process">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex size-9 items-center justify-center rounded-lg border bg-background hover:bg-muted transition text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`size-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors ${
              autoRefresh ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-background hover:bg-muted text-muted-foreground'
            }`}
          >
            {autoRefresh ? 'Auto-Refresh: On' : 'Auto-Refresh: Off'}
          </button>
        </div>
      </div>

      {/* Main View Area */}
      {activeTab === 'visual' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Visual Canvas Block */}
          <div className="lg:col-span-2 rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div>
                <h2 className="text-sm font-medium">Pool Routing Visualization</h2>
                <p className="text-xs text-muted-foreground">Select nodes to view error telemetry and rate limit logs.</p>
              </div>

              <button
                onClick={() => setAnimating(!animating)}
                className="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition"
              >
                {animating ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {animating ? 'Pause Flow' : 'Play Flow'}
              </button>
            </div>

            <div className="space-y-6">
              {/* Router Node */}
              <div className="flex justify-center">
                <div 
                  onClick={() => setSelectedNode({ type: 'provider', data: { name: 'FreeLLMAPI Router', type: 'Router Core' } })}
                  className="cursor-pointer flex items-center gap-2.5 rounded-xl border bg-muted/65 px-5 py-3 hover:bg-muted transition shadow-sm"
                >
                  <Zap className="size-4.5 text-indigo-500" />
                  <div>
                    <div className="text-xs font-semibold text-foreground">FreeLLMAPI Unified Router</div>
                    <div className="text-[10px] text-muted-foreground">Multi-Armed Bandit Routing</div>
                  </div>
                </div>
              </div>

              {/* Grouped Pools */}
              <div className="space-y-4">
                {filteredPools.map((pool) => (
                  <div key={pool.poolKey} className="rounded-2xl border bg-muted/20 p-4">
                    <div 
                      onClick={() => setSelectedNode({ type: 'pool', data: pool })}
                      className="flex cursor-pointer items-center justify-between border-b pb-2 mb-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-2 rounded-full bg-emerald-500" />
                        <span className="text-xs font-semibold text-foreground">{pool.providerDisplayName}</span>
                        <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{pool.poolKey}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span>{pool.models.length} Models Pooled</span>
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      </div>
                    </div>

                    {/* Pooled Models Grid */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {pool.models.map((m) => {
                        const isHealthy = m.healthStatus === 'healthy'
                        const isCooling = m.healthStatus === 'cooling_down'
                        const isDegraded = m.healthStatus === 'degraded'

                        return (
                          <div
                            key={m.id}
                            onClick={() => setSelectedNode({ type: 'model', data: { model: m, pool } })}
                            className={`group flex cursor-pointer items-center justify-between rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 ${
                              isHealthy
                                ? 'border-emerald-500/20'
                                : isCooling
                                ? 'border-amber-500/20 bg-amber-500/5'
                                : isDegraded
                                ? 'border-destructive/20 bg-destructive/5'
                                : 'opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${
                                isHealthy ? 'bg-emerald-500' : isCooling ? 'bg-amber-500 animate-pulse' : isDegraded ? 'bg-destructive' : 'bg-muted-foreground'
                              }`} />
                              <div>
                                <div className="text-xs font-medium text-foreground">
                                  {m.displayName || m.modelId}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {isHealthy ? 'Routable & Healthy' : isCooling ? `Cooling down (${Math.round((m.cooldownExpiresInMs ?? 0)/1000)}s)` : isDegraded ? `Degraded (${m.penaltyHits} hits)` : 'Disabled'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-70">
                              {m.supportsVision && <Eye className="size-3 text-muted-foreground" />}
                              {m.supportsTools && <Wrench className="size-3 text-muted-foreground" />}
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

          {/* Inspector Panel Block */}
          <div className="rounded-3xl border bg-card p-5">
            <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
              <Sliders className="size-4 text-muted-foreground" />
              Node Inspector
            </h2>

            {selectedNode ? (
              <div className="space-y-4 text-xs">
                {selectedNode.type === 'model' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border bg-muted/40 p-4">
                      <div className="font-semibold text-foreground text-sm">{selectedNode.data.model.displayName}</div>
                      <div className="font-mono text-muted-foreground text-[10px]">{selectedNode.data.model.modelId}</div>
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium border uppercase" style={{
                        borderColor: selectedNode.data.model.healthStatus === 'healthy' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                        color: selectedNode.data.model.healthStatus === 'healthy' ? '#10b981' : '#f59e0b',
                        backgroundColor: selectedNode.data.model.healthStatus === 'healthy' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.05)',
                      }}>
                        {selectedNode.data.model.healthStatus}
                      </div>
                    </div>

                    <div className="rounded-xl border p-3 space-y-2">
                      <div className="font-semibold text-foreground">Score & Penalties</div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Penalty Hits:</span>
                        <span className="font-mono text-foreground font-medium">{selectedNode.data.model.penaltyHits}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Score Decay Multiplier:</span>
                        <span className="font-mono text-foreground font-medium">{selectedNode.data.model.penaltyFactor.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Context limit:</span>
                        <span className="font-mono text-foreground font-medium">{selectedNode.data.model.contextWindow ? `${selectedNode.data.model.contextWindow.toLocaleString()} ctx` : 'Standard'}</span>
                      </div>
                    </div>

                    {selectedNode.data.model.recentErrors?.length > 0 && (
                      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                        <div className="font-semibold text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3.5" /> Recent Errors
                        </div>
                        {selectedNode.data.model.recentErrors.map((err: any, idx: number) => (
                          <div key={idx} className="font-mono text-[10px] text-destructive border-t border-destructive/10 pt-1.5">
                            {err.error}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.type === 'pool' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border bg-muted/40 p-4">
                      <div className="font-semibold text-foreground text-sm">{selectedNode.data.providerDisplayName}</div>
                      <div className="font-mono text-emerald-500 text-[10px] mt-1">{selectedNode.data.poolKey}</div>
                    </div>

                    <div className="rounded-xl border p-3 space-y-2">
                      <div className="font-semibold text-foreground">Quota Pool Stats</div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Keys:</span>
                        <span className="font-mono text-foreground">{selectedNode.data.activeKeyCount}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Models:</span>
                        <span className="font-mono text-foreground">{selectedNode.data.models.length}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center text-muted-foreground border border-dashed rounded-2xl">
                <Sparkles className="mb-2 size-6 text-muted-foreground/60" />
                <p className="text-xs max-w-[200px]">Select any card node to run health inspect.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Mermaid Graph Rendering */}
      {activeTab === 'graph' && (
        <section className="rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between border-b pb-4 mb-4">
            <div>
              <h2 className="text-sm font-medium">Mermaid Topology Definition</h2>
              <p className="text-xs text-muted-foreground">Graph visualization showing router distribution layers.</p>
            </div>
            <button
              onClick={copyMermaidCode}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy className="size-3.5" /> Copy Code
            </button>
          </div>

          <div className="flex justify-center overflow-x-auto py-6 bg-slate-950 rounded-2xl">
            <div ref={mermaidRef} className="mermaid-chart" />
          </div>
        </section>
      )}

      {/* TAB 3: Mermaid Interactive Compiler */}
      {activeTab === 'compiler' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border bg-card p-5 flex flex-col">
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <h2 className="text-sm font-medium">Compiler Source</h2>
              <button
                onClick={() => compileCustomMermaid(customMermaidCode)}
                className="h-8 rounded-lg bg-foreground text-background px-3 text-xs font-medium hover:opacity-90 transition-opacity"
              >
                Compile Code
              </button>
            </div>

            <textarea
              value={customMermaidCode}
              onChange={(e) => {
                setCustomMermaidCode(e.target.value)
                compileCustomMermaid(e.target.value)
              }}
              rows={16}
              className="w-full flex-1 rounded-xl border bg-background p-4 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />

            {compilerError && (
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs text-destructive">
                Syntax Error: {compilerError}
              </div>
            )}
          </section>

          <section className="rounded-3xl border bg-card p-5">
            <h2 className="text-sm font-medium border-b pb-4 mb-4">Compiled SVG Preview</h2>
            <div 
              className="mermaid-chart flex justify-center overflow-x-auto py-6 bg-slate-950 rounded-2xl"
              dangerouslySetInnerHTML={{ __html: compilerSvg }}
            />
          </section>
        </div>
      )}

      {/* TAB 4: Pools list cards */}
      {activeTab === 'cards' && (
        <div className="grid gap-6 md:grid-cols-2">
          {filteredPools.map((pool) => (
            <div
              key={pool.poolKey}
              className="rounded-3xl border bg-card p-6 flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {pool.providerDisplayName}
                    </span>
                    <h3 className="mt-1.5 font-mono text-base font-bold text-foreground">{pool.poolKey}</h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {pool.activeKeyCount} Keys
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {pool.models.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-1.5 rounded-lg border bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      <span className={`size-1.5 rounded-full ${
                        m.healthStatus === 'healthy' ? 'bg-emerald-500' : m.healthStatus === 'cooling_down' ? 'bg-amber-500' : 'bg-destructive'
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

      {/* TAB 5: Technical Details */}
      {activeTab === 'explanation' && (
        <section className="rounded-3xl border bg-card p-6 space-y-6 text-slate-300 text-xs leading-relaxed">
          <h2 className="text-base font-semibold text-foreground border-b pb-3 flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-500" />
            Detection & Quota Management Engine
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 rounded-2xl border bg-muted/10 p-4">
              <h3 className="text-sm font-semibold text-indigo-400">1. Quota Pool Routing</h3>
              <p className="text-muted-foreground">
                Upstream platforms restrict usage limits across shared project pools or individual accounts. FreeLLMAPI maps shared resources using <code className="font-mono text-emerald-500">inferQuotaPoolKey(platform, modelId)</code>. Any rate-limit header response (e.g. 429 Retry-After) temporarily halts routing to all models in that pool.
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border bg-muted/10 p-4">
              <h3 className="text-sm font-semibold text-amber-400">2. Deterioration Detection</h3>
              <p className="text-muted-foreground">
                The router scoring engine penalizes models on recurrent 5xx or DNS timeouts, decaying routing scores dynamically. Proactive background checker loops probe keys every 5 minutes to quarantine invalid credentials instantly.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
