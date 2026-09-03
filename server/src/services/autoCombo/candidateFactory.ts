import { getDb } from '../../db/index.js';
import type { ChainRow } from '../router.js';
import { getActiveChain } from '../router.js';
import { getActiveProfileId } from '../profile-models.js';
import type { AutoCandidate, RoutingContext } from './types.js';
import { getProviderDailyRequestCap } from '../ratelimit.js';
import { inferQuotaPoolKey } from '../provider-quota.js';
import { taskFitnessFromCategory } from './taskFitness.js';
import { isProviderEligible } from '../../providers/policy.js';
import { getProviderDefinition } from '../../providers/definitions/index.js';

function pricingFor(platform: string, modelId: string): { input: number | null; output: number | null } {
  try {
    const db = getDb();
    const row = db.prepare('SELECT paid_input_per_m as inp, paid_output_per_m as outp FROM models WHERE platform = ? AND model_id = ?').get(platform, modelId) as any;
    return { input: row?.inp ?? null, output: row?.outp ?? null };
  } catch {
    return { input: null, output: null };
  }
}

function blendedCost(input: number | null, output: number | null): number {
  const i = input ?? 0.2;
  const o = output ?? 0.8;
  return 0.6 * i + 0.4 * o;
}

function inferTier(sizeLabel: string | undefined): 'free' | 'standard' | 'pro' | 'ultra' {
  if (sizeLabel === 'Frontier') return 'ultra';
  if (sizeLabel === 'Large') return 'pro';
  if (sizeLabel === 'Medium') return 'standard';
  return 'free';
}

export function buildCandidatePool(context: RoutingContext): AutoCandidate[] {
  const db = getDb();
  const activeProfileId = getActiveProfileId(db);
  let rows: ChainRow[];
  if (activeProfileId != null) {
    rows = db.prepare(`
      SELECT m.id as model_db_id, COALESCE(pm.priority, fc.priority, 0) as priority,
             COALESCE(pm.enabled, fc.enabled, 1) as enabled,
             m.platform, m.model_id, m.display_name, m.intelligence_rank, m.speed_rank,
             m.size_label, m.monthly_token_budget,
             m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit,
             m.supports_vision, m.supports_tools, m.context_window, m.key_id, m.endpoint_scope,
             m.paid_input_per_m, m.paid_output_per_m
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      LEFT JOIN profile_models pm ON pm.profile_id = ? AND pm.model_db_id = m.id
      LEFT JOIN provider_catalog_models pcm ON pcm.provider_slug = m.platform AND pcm.provider_model_id = m.model_id
      WHERE m.enabled = 1
        AND COALESCE(pm.enabled, fc.enabled, 1) = 1
        AND (pcm.status IS NULL OR pcm.status IN ('active', 'candidate'))
    `).all(activeProfileId) as ChainRow[];
  } else {
    rows = db.prepare(`
      SELECT m.id as model_db_id, COALESCE(fc.priority, 0) as priority,
             COALESCE(fc.enabled, 1) as enabled,
             m.platform, m.model_id, m.display_name, m.intelligence_rank, m.speed_rank,
             m.size_label, m.monthly_token_budget,
             m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit,
             m.supports_vision, m.supports_tools, m.context_window, m.key_id, m.endpoint_scope,
             m.paid_input_per_m, m.paid_output_per_m
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      LEFT JOIN provider_catalog_models pcm ON pcm.provider_slug = m.platform AND pcm.provider_model_id = m.model_id
      WHERE m.enabled = 1
        AND COALESCE(fc.enabled, 1) = 1
        AND (pcm.status IS NULL OR pcm.status IN ('active', 'candidate'))
    `).all() as ChainRow[];
  }

  // Check each model has at least one healthy key
  const healthyKeys = db.prepare("SELECT platform, COUNT(*) as cnt FROM api_keys WHERE enabled=1 AND status IN ('healthy','unknown') GROUP BY platform").all() as { platform: string; cnt: number }[];
  const healthySet = new Set(healthyKeys.filter(r => r.cnt>0).map(r=>r.platform));

  // Also fetch per-model key scope: filter custom etc later via selectKeyForModel will handle, but for candidate existence we allow if platform healthy
  const candidates: AutoCandidate[] = [];
  for (const r of rows) {
    if (!isProviderEligible(r.platform)) continue;
    if (!healthySet.has(r.platform)) continue;

    // Skip if no key at all (but healthySet already implies at least one)
    // For custom, need specific key check - allow
    const pricing = { input: (r as any).paid_input_per_m, output: (r as any).paid_output_per_m };
    const cost = blendedCost(pricing.input, pricing.output);

    // Fetch stats from analytics if available: requests table for latency/p95 etc
    // For now use speed_rank and intelligence_rank to derive synthetic latency/costs
    // p95 latency: lower speed_rank (1 fast) => lower latency
    const speedRank = (r as any).speed_rank ?? 5;
    let p95 = 200 + speedRank * 120;
    let stdDev: number | undefined = 300;

    // Health score: check if currently on cooldown (approx via ratelimit)
    // Use provider quota etc later; for now default 1
    let healthScore = 0.9;
    let quotaScore = 0.8;
    let errorRate = 0.05;
    let reliabilityScore = 0.95;

    // Try to compute from requests table last 7 days
    try {
      const stats = db.prepare(`
        SELECT
          SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successes,
          COUNT(*) as total,
          AVG(CASE WHEN status='success' AND latency_ms IS NOT NULL THEN latency_ms ELSE NULL END) as avgLat,
          MAX(latency_ms) as maxLat
        FROM requests WHERE platform = ? AND model_id = ? AND created_at >= datetime('now','-7 days')
      `).get(r.platform, r.model_id) as any;
      if (stats && stats.total > 0) {
        const successes = stats.successes ?? 0;
        const total = stats.total;
        errorRate = total > 0 ? (total - successes) / total : 0.05;
        reliabilityScore = 1 - errorRate;
        if (stats.avgLat) p95 = Math.round(stats.avgLat * 1.2);
        // health degrades with errorRate
        healthScore = Math.max(0, 1 - errorRate * 2);
        // quota headroom derived from provider daily cap vs usage
        const cap = getProviderDailyRequestCap(r.platform);
        if (cap) {
          const used = successes + (total - successes);
          quotaScore = Math.max(0, 1 - used / cap);
        }
      }
    } catch {}

    const tier = inferTier(r.size_label);

    const chainRow: ChainRow = {
      model_db_id: r.model_db_id,
      priority: r.priority,
      enabled: r.enabled,
      platform: r.platform,
      model_id: r.model_id,
      display_name: r.display_name,
      intelligence_rank: r.intelligence_rank,
      size_label: r.size_label,
      monthly_token_budget: r.monthly_token_budget,
      rpm_limit: r.rpm_limit,
      rpd_limit: r.rpd_limit,
      tpm_limit: r.tpm_limit,
      tpd_limit: r.tpd_limit,
      supports_vision: r.supports_vision,
      supports_tools: r.supports_tools,
      context_window: r.context_window,
      key_id: r.key_id,
      endpoint_scope: r.endpoint_scope,
    };

    const def = getProviderDefinition(r.platform);
    const candidate: AutoCandidate = {
      provider: r.platform,
      model: r.model_id,
      displayName: r.display_name,
      modelDbId: r.model_db_id,
      infrastructureGroup: def?.infrastructureGroup ?? r.platform,
      providerType: def?.providerType ?? 'native',
      costPer1MTokens: cost,
      inputCost: pricing.input ?? undefined,
      outputCost: pricing.output ?? undefined,
      p95LatencyMs: p95,
      latencyStdDev: stdDev,
      quotaScore,
      healthScore,
      errorRate,
      reliabilityScore,
      taskFitScore: taskFitnessFromCategory({ provider: r.platform, model: r.model_id, displayName: r.display_name, costPer1MTokens: cost, p95LatencyMs: p95, quotaScore, healthScore, errorRate, reliabilityScore, taskFitScore: 0.5, chainRow } as any, context.category),
      tier,
      contextWindow: r.context_window,
      supportsVision: !!r.supports_vision,
      supportsTools: !!r.supports_tools,
      supportsReasoning: r.size_label === 'Frontier' || r.model_id.toLowerCase().includes('reasoning'),
      sessionAvailability: 1,
      connectionDensity: 0.5,
      cacheAffinity: 0.5,
      resetWindowAffinity: 0.5,
      quality: 0.5,
      circuitBreakerState: 'CLOSED',
      chainRow,
    };
    candidates.push(candidate);
  }
  return candidates;
}
