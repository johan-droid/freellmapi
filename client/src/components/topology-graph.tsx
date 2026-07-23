import { useMemo, useRef } from 'react'
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

interface TopologyGraphProps {
  pools: QuotaPool[]
}

interface LayoutNode {
  id: string
  label: string
  type: 'router' | 'provider' | 'pool' | 'model'
  x: number
  y: number
  width: number
  height: number
  health?: string
  parentId?: string
}

function getHealthColor(status?: string): string {
  if (status === 'healthy') return '#22c55e'
  if (status === 'cooling_down') return '#f59e0b'
  if (status === 'degraded' || status === 'unusable') return '#ef4444'
  return '#64748b'
}

const NODE_HEIGHT = 36
const ROUTER_HEIGHT = 44
const MODEL_HEIGHT = 30
const LEVEL_GAP_Y = 80
const NODE_GAP_X = 16
const PAD_X = 32
const PAD_Y = 32

export function TopologyGraph({ pools }: TopologyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const { nodes, edges } = useMemo(() => {
    const nodes: LayoutNode[] = []
    const edges: Array<{ from: string; to: string }> = []

    const routerId = 'router'
    nodes.push({
      id: routerId,
      label: '⚡ FreeLLMAPI Unified Router',
      type: 'router',
      x: 0,
      y: PAD_Y,
      width: 240,
      height: ROUTER_HEIGHT,
    })

    const grouped = new Map<string, QuotaPool[]>()
    for (const pool of pools) {
      const list = grouped.get(pool.providerSlug) || []
      list.push(pool)
      grouped.set(pool.providerSlug, list)
    }

    const providerEntries = Array.from(grouped.entries())
    const providerY = PAD_Y + ROUTER_HEIGHT + LEVEL_GAP_Y

    let providerX = PAD_X

    for (const [slug, providerPools] of providerEntries) {
      const displayName = providerPools[0]?.providerDisplayName || slug
      const providerId = `provider_${slug}`
      const providerWidth = 180

      nodes.push({
        id: providerId,
        label: `🏢 ${displayName}`,
        type: 'provider',
        x: providerX,
        y: providerY,
        width: providerWidth,
        height: NODE_HEIGHT,
      })
      edges.push({ from: routerId, to: providerId })

      const poolY = providerY + NODE_HEIGHT + LEVEL_GAP_Y
      let poolX = providerX

      for (const pool of providerPools) {
        const poolId = `pool_${pool.poolKey.replace(/[^a-zA-Z0-9]/g, '_')}`
        const poolWidth = Math.max(160, pool.poolKey.length * 8.5)

        nodes.push({
          id: poolId,
          label: `🏊 ${pool.poolKey}`,
          type: 'pool',
          x: poolX,
          y: poolY,
          width: poolWidth,
          height: NODE_HEIGHT,
        })
        edges.push({ from: providerId, to: poolId })

        const modelY = poolY + NODE_HEIGHT + LEVEL_GAP_Y - 20
        let modelX = poolX

        for (const m of pool.models.slice(0, 5)) {
          const modelId = `model_${m.id}`
          const cleanName = (m.displayName || m.modelId)
          const modelWidth = Math.max(130, cleanName.length * 7.5 + 30)

          nodes.push({
            id: modelId,
            label: `${cleanName}`,
            type: 'model',
            x: modelX,
            y: modelY,
            width: modelWidth,
            height: MODEL_HEIGHT,
            health: m.healthStatus,
            parentId: poolId,
          })
          edges.push({ from: poolId, to: modelId })
          modelX += modelWidth + NODE_GAP_X
        }

        poolX += poolWidth + NODE_GAP_X
      }

      providerX += providerWidth + NODE_GAP_X
    }

    const svgWidth = Math.max(providerX + PAD_X, 800)
    const svgHeight = providerY + NODE_HEIGHT + LEVEL_GAP_Y + MODEL_HEIGHT + 60

    return { nodes, edges, svgWidth, svgHeight }
  }, [pools])

  const svgWidth = useMemo(() => Math.max(nodes.reduce((m, n) => Math.max(m, n.x + n.width + PAD_X), 0), 800), [nodes])
  const svgHeight = useMemo(() => Math.max(nodes.reduce((m, n) => Math.max(m, n.y + n.height + PAD_Y), 0), 400), [nodes])

  if (pools.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-xs">
        No pool data available.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full overflow-auto">
      <svg width={svgWidth} height={svgHeight} className="min-w-full">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#475569" />
          </marker>
          {['healthy', 'cooling_down', 'degraded', 'unusable', 'default'].map((s) => (
            <marker key={s} id={`arrowhead_${s}`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill={getHealthColor(s === 'default' ? undefined : s)} />
            </marker>
          ))}
        </defs>

        {edges.map((edge, i) => {
          const from = nodes.find((n) => n.id === edge.from)
          const to = nodes.find((n) => n.id === edge.to)
          if (!from || !to) return null

          const x1 = from.x + from.width / 2
          const y1 = from.y + from.height
          const x2 = to.x + to.width / 2
          const y2 = to.y

          return (
            <g key={i}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="#475569"
                strokeWidth="1.5"
                markerEnd={`url(#arrowhead)`}
              />
            </g>
          )
        })}

        {nodes.map((node) => {
          if (node.type === 'router') {
            return (
              <g key={node.id}>
                <rect
                  x={node.x} y={node.y}
                  width={node.width} height={node.height}
                  rx="10" ry="10"
                  fill="#1e1b4b"
                  stroke="#818cf8"
                  strokeWidth="2"
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e0e7ff"
                  fontSize="13"
                  fontWeight="600"
                >
                  {node.label}
                </text>
              </g>
            )
          }

          if (node.type === 'provider') {
            return (
              <g key={node.id}>
                <rect
                  x={node.x} y={node.y}
                  width={node.width} height={node.height}
                  rx="8" ry="8"
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#f0f9ff"
                  fontSize="11"
                  fontWeight="500"
                >
                  {node.label}
                </text>
              </g>
            )
          }

          if (node.type === 'pool') {
            return (
              <g key={node.id}>
                <rect
                  x={node.x} y={node.y}
                  width={node.width} height={node.height}
                  rx="8" ry="8"
                  fill="#064e3b"
                  stroke="#34d399"
                  strokeWidth="1.5"
                />
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ecfdf5"
                  fontSize="10"
                  fontWeight="500"
                >
                  {node.label}
                </text>
              </g>
            )
          }

          if (node.type === 'model') {
            const healthColor = getHealthColor(node.health)
            return (
              <g key={node.id}>
                <rect
                  x={node.x} y={node.y}
                  width={node.width} height={node.height}
                  rx="6" ry="6"
                  fill={node.health === 'healthy' ? '#14532d' : node.health === 'cooling_down' ? '#78350f' : node.health === 'degraded' ? '#7f1d1d' : node.health === 'unusable' ? '#1e293b' : '#1e293b'}
                  stroke={healthColor}
                  strokeWidth={node.health === 'healthy' ? '1' : node.health === 'unusable' ? '1' : '1.5'}
                  strokeDasharray={node.health === 'unusable' ? '3 3' : 'none'}
                />
                <circle cx={node.x + 12} cy={node.y + node.height / 2} r="4" fill={healthColor} />
                <text
                  x={node.x + 22}
                  y={node.y + node.height / 2}
                  textAnchor="start"
                  dominantBaseline="central"
                  fill="#f8fafc"
                  fontSize="10"
                  fontWeight="400"
                >
                  {node.label.length > 24 ? node.label.slice(0, 23) + '…' : node.label}
                </text>
              </g>
            )
          }

          return null
        })}
      </svg>
    </div>
  )
}
