import type { AutoCandidate, AutoScoringWeights, FactorName, RoutingContext } from './types.js';
import { DEFAULT_WEIGHTS, FACTORS } from './types.js';
import { normalizeScoringWeights } from './types.js';
import { taskFitnessFromCategory } from './taskFitness.js';

export { normalizeScoringWeights };

export interface ScoringOptions {
  weights?: Record<string, number>;
  context?: RoutingContext;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalizeRelative(value: number, min: number, max: number, invert = false): number {
  if (max <= min) return 0.5;
  const n = (value - min) / (max - min);
  const clamped = clamp01(n);
  return invert ? 1 - clamped : clamped;
}

export function computeFactorScores(
  pool: AutoCandidate[],
  context?: RoutingContext,
): Map<AutoCandidate, Record<FactorName, number>> {
  const result = new Map<AutoCandidate, Record<FactorName, number>>();
  if (pool.length === 0) return result;

  // Precompute pool stats for relative normalizations
  const costs = pool.map(c => c.costPer1MTokens ?? 0);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const latencies = pool.map(c => c.p95LatencyMs ?? 1000);
  const minLat = Math.min(...latencies);
  const maxLat = Math.max(...latencies);
  const stabilities = pool.map(c => c.latencyStdDev ?? 0);
  const minStab = Math.min(...stabilities);
  const maxStab = Math.max(...stabilities);

  // Connection density counts per provider
  const providerCounts = new Map<string, number>();
  for (const c of pool) providerCounts.set(c.provider, (providerCounts.get(c.provider) ?? 0) + 1);
  const maxDensity = Math.max(...[...providerCounts.values()], 1);

  for (const c of pool) {
    const scores: Record<FactorName, number> = {} as any;

    // quota 0..1
    scores.quota = clamp01(c.quotaScore ?? 0.5);

    // health based on circuit state and healthScore
    if (c.circuitBreakerState === 'OPEN') scores.health = 0;
    else if (c.circuitBreakerState === 'HALF_OPEN') scores.health = 0.5;
    else scores.health = clamp01(c.healthScore ?? 0.7);

    // costInv cheaper = higher; relative to pool
    scores.costInv = normalizeRelative(c.costPer1MTokens ?? 0, minCost, maxCost, true);
    // If costs are all zero (unknown), treat as neutral 0.5
    if (maxCost === 0) scores.costInv = 0.5;

    // latencyInv faster = higher
    scores.latencyInv = normalizeRelative(c.p95LatencyMs ?? 1500, minLat, maxLat, true);

    // taskFit
    scores.taskFit = clamp01(c.taskFitScore ?? taskFitnessFromCategory(c, context?.category) ?? 0.5);

    // stability: lower stddev = higher
    const stabRaw = c.latencyStdDev ?? 500; // default moderate
    scores.stability = normalizeRelative(stabRaw, minStab, maxStab, true);
    if (stabilities.every(v => v === 0)) scores.stability = 0.5;

    // tierPriority
    const tierMap: Record<string, number> = { free: 0, standard: 0.33, pro: 0.67, ultra: 1 };
    const baseTier = tierMap[c.tier ?? 'standard'] ?? 0.33;
    const chainRank = Math.max(0, 1 - ((c.chainRow.priority ?? 1) - 1) * 0.05);
    scores.tierPriority = 0.5 * baseTier + 0.5 * chainRank;

    // tierAffinity: how appropriate tier is for task
    // For coding/reasoning prefer pro/ultra, for chat/fast prefer standard/free
    let tierAffinity = 0.5;
    const cat = context?.category;
    if (cat === 'coding' || cat === 'reasoning') {
      if (c.tier === 'pro' || c.tier === 'ultra') tierAffinity = 0.9;
      else if (c.tier === 'standard') tierAffinity = 0.6;
      else tierAffinity = 0.3;
    } else if (cat === 'chat' || context?.tier === 'fast') {
      if (c.tier === 'free' || c.tier === 'standard') tierAffinity = 0.8;
      else tierAffinity = 0.5;
    }
    scores.tierAffinity = tierAffinity;

    // specificityMatch: request complexity vs capability. Use contextWindow and tier as proxy.
    // Hard constraint already filtered oversized, here give bonus to larger window for large requests
    let spec = 0.5;
    if (context?.estimatedTotalTokens && c.contextWindow) {
      const ratio = context.estimatedTotalTokens / c.contextWindow;
      if (ratio < 0.25) spec = c.tier === 'free' ? 0.8 : 0.5; // small request ok on cheap
      else if (ratio < 0.75) spec = 0.7;
      else spec = c.tier === 'pro' || c.tier === 'ultra' ? 0.9 : 0.6;
    }
    scores.specificityMatch = spec;

    // contextAffinity: prefer larger window, but already hard filtered
    if (c.contextWindow == null) scores.contextAffinity = 0.5;
    else if (context?.estimatedTotalTokens) {
      const headroom = (c.contextWindow - context.estimatedTotalTokens) / c.contextWindow;
      scores.contextAffinity = clamp01(headroom); // more headroom = better
    } else {
      scores.contextAffinity = clamp01(Math.min(1, c.contextWindow / 128000));
    }

    // sessionAvailability
    scores.sessionAvailability = clamp01(c.sessionAvailability ?? 1);

    // connectionDensity: avoid concentration; lower provider/infra density = higher score
    const infraGroup = c.infrastructureGroup ?? c.provider;
    const infraCount = pool.filter(p => (p.infrastructureGroup ?? p.provider) === infraGroup).length;
    const density = providerCounts.get(c.provider) ?? 1;
    const isAggregator = c.providerType === 'aggregator' || c.infrastructureGroup?.startsWith('aggregator:');
    const aggregatorPenalty = isAggregator ? 0.15 : 0.0;
    const rawDensityScore = 1 - (density - 1) / Math.max(1, maxDensity - 1) - (infraCount > 1 ? 0.1 : 0.0) - aggregatorPenalty;
    scores.connectionDensity = clamp01(maxDensity === 1 ? 1.0 - aggregatorPenalty : rawDensityScore);

    // cacheAffinity neutral if no infra
    scores.cacheAffinity = clamp01(c.cacheAffinity ?? 0.5);

    // resetWindowAffinity
    scores.resetWindowAffinity = clamp01(c.resetWindowAffinity ?? 0.5);

    // quality: default 0.5 if no observations
    scores.quality = clamp01(c.quality ?? 0.5);

    // reliability: 1 - errorRate with minimum observation threshold
    // If sample size tiny, damp toward 0.5
    const rawRel = c.reliabilityScore ?? (1 - (c.errorRate ?? 0.1));
    scores.reliability = clamp01(rawRel);

    result.set(c, scores);
  }
  return result;
}

export function scoreCandidate(
  candidate: AutoCandidate,
  pool: AutoCandidate[],
  weights?: Record<string, number>,
  context?: RoutingContext,
): number {
  const w = weights ? normalizeScoringWeights(weights) : DEFAULT_WEIGHTS;
  const scoresMap = computeFactorScores(pool, context);
  const scores = scoresMap.get(candidate);
  if (!scores) return 0;
  let total = 0;
  for (const f of FACTORS) {
    const weight = (w as any)[f] ?? 0;
    total += weight * (scores[f] ?? 0);
  }
  return clamp01(total);
}

export function scorePool(
  pool: AutoCandidate[],
  weights?: Record<string, number>,
  context?: RoutingContext,
): Map<AutoCandidate, number> {
  const w = weights ? normalizeScoringWeights(weights) : DEFAULT_WEIGHTS;
  const factorMap = computeFactorScores(pool, context);
  const out = new Map<AutoCandidate, number>();
  for (const c of pool) {
    const scores = factorMap.get(c)!;
    let total = 0;
    for (const f of FACTORS) {
      total += (w as any)[f] * (scores[f] ?? 0);
    }
    candidateFillRaw(c, scores, total);
    out.set(c, clamp01(total));
  }
  return out;
}

function candidateFillRaw(c: AutoCandidate, scores: Record<string, number>, total: number) {
  c._rawScores = { ...scores } as any;
  c._finalScore = total;
}
