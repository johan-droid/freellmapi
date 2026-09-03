import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Cpu, RefreshCw, ShieldAlert, Zap, Sliders, Copy, Check } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { ModelsTabs } from '@/components/models-tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'

interface RouterStatus {
  activeProviders: number
  eligibleCandidates: number
  healthy: number
  degraded: number
  unavailable: number
  incidentMode: boolean
  currentStrategy: string
  exploration: number
  topProviders: Array<{ provider: string; model: string; score: number }>
  exclusions: Array<{ key: string; until: number; attempts: number }>
}

interface CandidateItem {
  provider: string
  model: string
  available: boolean
  health: number
  excluded: boolean
  reason: string
}

interface DiscoveryData {
  supported: string[]
  strategies: string[]
  explorationRate: number
  candidateCount: number
}

const PRESET_MODELS = [
  { id: 'auto', desc: 'Zero-config dynamic routing based on live metrics' },
  { id: 'auto/coding', desc: 'Prioritizes coding fitness & tool-capable models' },
  { id: 'auto/fast', desc: 'Prioritizes lowest latency candidates' },
  { id: 'auto/cheap', desc: 'Prioritizes lowest cost candidates' },
  { id: 'auto/reliable', desc: 'Prioritizes high stability and high reliability' },
  { id: 'auto/offline', desc: 'Prioritizes maximum remaining quota headroom' },
  { id: 'auto/reasoning', desc: 'Prioritizes reasoning & chain-of-thought models' },
  { id: 'auto/vision', desc: 'Routes exclusively to vision-capable models' },
  { id: 'auto/coding:fast', desc: 'Composable: fast coding model selection' },
  { id: 'auto/coding:cheap', desc: 'Composable: cheapest coding model selection' },
  { id: 'auto/reasoning:pro', desc: 'Composable: frontier reasoning tier model' },
]

export default function AutoRoutingPage() {
  const queryClient = useQueryClient()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [explorationInput, setExplorationInput] = useState<string>('')

  const { data: status, refetch: refetchStatus } = useQuery<RouterStatus>({
    queryKey: ['auto-combo-status'],
    queryFn: () => apiFetch('/api/auto-combo/status'),
    refetchInterval: 10000,
  })

  const { data: candidates = [], isLoading: candidatesLoading } = useQuery<CandidateItem[]>({
    queryKey: ['auto-combo-candidates'],
    queryFn: () => apiFetch('/api/auto-combo/candidates'),
    refetchInterval: 10000,
  })

  useQuery<DiscoveryData>({
    queryKey: ['auto-combo-discovery'],
    queryFn: () => apiFetch('/api/auto-combo'),
  })

  const excludeMutation = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      apiFetch(`/api/auto-combo/candidates/${encodeURIComponent(provider)}/${encodeURIComponent(model)}/exclude`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Manual exclusion from dashboard' }),
      }),
    onSuccess: () => {
      toast.success('Candidate excluded from Auto Routing')
      queryClient.invalidateQueries({ queryKey: ['auto-combo-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['auto-combo-status'] })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      apiFetch(`/api/auto-combo/candidates/${encodeURIComponent(provider)}/${encodeURIComponent(model)}/restore`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast.success('Candidate restored to Auto Routing')
      queryClient.invalidateQueries({ queryKey: ['auto-combo-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['auto-combo-status'] })
    },
  })

  const explorationMutation = useMutation({
    mutationFn: (rate: number) =>
      apiFetch('/api/auto-combo/exploration', {
        method: 'POST',
        body: JSON.stringify({ rate }),
      }),
    onSuccess: () => {
      toast.success('Exploration rate updated')
      queryClient.invalidateQueries({ queryKey: ['auto-combo-status'] })
      queryClient.invalidateQueries({ queryKey: ['auto-combo-discovery'] })
    },
  })

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSetExploration = () => {
    const n = parseFloat(explorationInput)
    if (!isNaN(n) && n >= 0 && n <= 1) {
      explorationMutation.mutate(n)
    } else {
      toast.error('Exploration rate must be between 0 and 1 (e.g. 0.05)')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auto Routing"
        description="Intelligent zero-config model router powered by live provider health, latency, cost, and task fitness metrics."
        actions={<ModelsTabs />}
      />

      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Active Providers</span>
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{status?.activeProviders ?? 0}</div>
          <p className="text-xs text-muted-foreground">{status?.eligibleCandidates ?? 0} eligible candidate models</p>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Provider Health</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-500">{status?.healthy ?? 0}</span>
            <span className="text-xs text-muted-foreground">healthy</span>
            {status?.degraded ? <span className="text-xs text-amber-500">{status.degraded} degraded</span> : null}
            {status?.unavailable ? <span className="text-xs text-destructive">{status.unavailable} open</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {status?.incidentMode ? (
              <span className="text-destructive font-medium flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Incident Mode Active
              </span>
            ) : (
              'Normal Operation'
            )}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Routing Strategy</span>
            <Zap className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold capitalize">{status?.currentStrategy ?? 'rules'}</div>
          <p className="text-xs text-muted-foreground">16-factor scoring engine</p>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Exploration Rate</span>
            <Activity className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold">{((status?.exploration ?? 0.05) * 100).toFixed(0)}%</div>
          <p className="text-xs text-muted-foreground">Epsilon-greedy bandit allocation</p>
        </div>
      </div>

      {/* Exploration & Strategy Controls */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" /> Exploration Rate Control
        </h3>
        <div className="flex items-center gap-3 max-w-md">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            placeholder={`Current: ${status?.exploration ?? 0.05}`}
            value={explorationInput}
            onChange={(e) => setExplorationInput(e.target.value)}
            className="h-9"
          />
          <Button size="sm" onClick={handleSetExploration} disabled={explorationMutation.isPending}>
            Update Rate
          </Button>
        </div>
      </div>

      {/* Candidate Matrix Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-sm font-semibold">Auto Candidate Pool Matrix</h3>
            <p className="text-xs text-muted-foreground">Real-time candidate health, latency, scores, and candidate overrides.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase font-mono border-b">
              <tr>
                <th className="p-3">Provider</th>
                <th className="p-3">Model</th>
                <th className="p-3">Health Score</th>
                <th className="p-3">Availability</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    {candidatesLoading ? 'Loading auto candidates...' : 'No candidate models currently eligible for Auto Routing.'}
                  </td>
                </tr>
              ) : (
                candidates.map((c) => (
                  <tr key={`${c.provider}:${c.model}`} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-medium capitalize">{c.provider}</td>
                    <td className="p-3 font-mono">{c.model}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.round((c.health ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-muted-foreground">{(c.health ?? 0).toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      {c.available ? (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive border-destructive/30">
                          {c.reason}
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">
                      {c.excluded ? (
                        <span className="text-amber-500 flex items-center gap-1 font-medium">
                          <ShieldAlert className="h-3 w-3" /> Excluded
                        </span>
                      ) : (
                        <span className="text-emerald-500 font-medium">Active</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {c.excluded ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => restoreMutation.mutate({ provider: c.provider, model: c.model })}
                          disabled={restoreMutation.isPending}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => excludeMutation.mutate({ provider: c.provider, model: c.model })}
                          disabled={excludeMutation.isPending}
                        >
                          Exclude
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Reference & Quick Copy Card */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Zero-Config Auto Model IDs</h3>
          <p className="text-xs text-muted-foreground">
            Pass any of these model IDs in your OpenAI-compatible API requests.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESET_MODELS.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:border-primary/50 transition-colors bg-muted/20"
            >
              <div className="space-y-0.5">
                <code className="text-xs font-semibold text-primary">{item.id}</code>
                <p className="text-[11px] text-muted-foreground leading-tight">{item.desc}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(item.id)}>
                {copiedId === item.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
