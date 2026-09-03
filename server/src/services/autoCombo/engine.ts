import { parseAutoPrefix } from './parser.js';
import type { AutoCandidate, RoutingContext, RoutingDecision } from './types.js';
import { DEFAULT_WEIGHTS } from './types.js';
import { buildCandidatePool } from './candidateFactory.js';
import { filterCandidates } from './candidateFilter.js';
import { getRouterStrategy, registerRouterStrategy } from './routerStrategy.js';
import { RulesStrategy } from './strategies/rules.js';
import { CostStrategy, EcoStrategy } from './strategies/cost.js';
import { LatencyStrategy, FastStrategy } from './strategies/latency.js';
import { SlaStrategy, SlaHardStrategy } from './strategies/sla.js';
import { LkgpStrategy } from './strategies/lkgp.js';
import { isIncidentMode, isTemporarilyExcluded, recordScoreDegradation, shouldProbe, setLastKnownGood } from './selfHealing.js';
import { shouldExplore, pickExplorationCandidate } from './exploration.js';
import { scorePool } from './scoring.js';
import { getModePackWeights } from './modePacks.js';
import { isOnCooldown } from '../ratelimit.js';

let strategiesRegistered = false;
export function ensureStrategies() {
  if (strategiesRegistered) return;
  registerRouterStrategy('rules', new RulesStrategy());
  registerRouterStrategy('cost', new CostStrategy());
  registerRouterStrategy('eco', new EcoStrategy());
  registerRouterStrategy('latency', new LatencyStrategy());
  registerRouterStrategy('fast', new FastStrategy());
  registerRouterStrategy('sla-aware', new SlaStrategy());
  registerRouterStrategy('sla', new SlaHardStrategy());
  registerRouterStrategy('lkgp', new LkgpStrategy());
  strategiesRegistered = true;
}

export interface AutoRouteResult {
  decision: RoutingDecision;
  candidate: AutoCandidate;
  incidentMode: boolean;
}

export function resolveAutoStrategyName(parsed: ReturnType<typeof parseAutoPrefix>, context: RoutingContext): string {
  if (parsed?.variant === 'lkgp') return 'lkgp';
  if (context.mode) {
    const m = context.mode.toLowerCase();
    if (['fast'].includes(m)) return 'fast';
    if (['cheap','cost-saver'].includes(m)) return 'cost';
    if (['reliable','reliability-first'].includes(m)) return 'rules'; // still rules but with weights
  }
  if (context.slaTargetP95Ms != null || context.slaMaxErrorRate != null) return 'sla-aware';
  return 'rules';
}

export function buildRoutingContext(opts: {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  hasTools: boolean;
  hasVision: boolean;
  modelString?: string;
  budget?: number | null;
  budgetFallback?: 'cheapest' | 'strict';
  mode?: string;
  slaTargetP95Ms?: number;
  slaMaxErrorRate?: number;
  slaMaxCostPer1MTokens?: number;
  slaHardConstraints?: boolean;
  requestId?: string;
  sessionKey?: string;
}): RoutingContext {
  const parsed = parseAutoPrefix(opts.modelString);
  return {
    estimatedInputTokens: opts.estimatedInputTokens,
    estimatedOutputTokens: opts.estimatedOutputTokens,
    estimatedTotalTokens: opts.estimatedInputTokens + opts.estimatedOutputTokens,
    hasTools: opts.hasTools,
    hasVision: opts.hasVision,
    category: parsed?.category,
    tier: parsed?.tier,
    variant: parsed?.variant,
    budget: opts.budget,
    budgetFallback: opts.budgetFallback,
    mode: opts.mode,
    slaTargetP95Ms: opts.slaTargetP95Ms,
    slaMaxErrorRate: opts.slaMaxErrorRate,
    slaMaxCostPer1MTokens: opts.slaMaxCostPer1MTokens,
    slaHardConstraints: opts.slaHardConstraints,
    requestId: opts.requestId,
    sessionKey: opts.sessionKey,
  };
}

export function selectAutoCandidate(
  modelString: string | undefined,
  context: RoutingContext,
  skipModelIds?: Set<number>,
  skipPlatforms?: Set<string>,
): AutoRouteResult | { error: string; status: number } {
  ensureStrategies();
  const parsed = parseAutoPrefix(modelString);
  if (parsed && !parsed.isValid) {
    return { error: parsed.error ?? 'Invalid auto model', status: 400 };
  }

  // 1-10: build pool
  let pool: AutoCandidate[];
  try {
    pool = buildCandidatePool(context);
  } catch (e: any) {
    // fail open to existing routing: throw to let caller fallback
    throw e;
  }

  if (pool.length === 0) {
    return { error: 'No eligible candidates for auto routing', status: 503 };
  }

  // Budget hard check for strict: if budget set and no candidate affordable, 402
  if (context.budget != null) {
    const affordable = pool.filter(c => (c.costPer1MTokens ?? 0) <= context.budget!);
    if (affordable.length === 0 && context.budgetFallback === 'strict') {
      return { error: `No candidate satisfies budget $${context.budget}`, status: 402 };
    }
  }

  // Filter
  let filtered = filterCandidates(pool, parsed, context);
  if (skipPlatforms && skipPlatforms.size > 0) {
    filtered = filtered.filter(c => !skipPlatforms.has(c.provider));
  }
  if (skipModelIds && skipModelIds.size > 0) {
    filtered = filtered.filter(c => !skipModelIds.has(c.modelDbId));
  }

  // After filter, if budget strict and empty => 402 already handled; else if empty due to hard constraints, return error
  if (filtered.length === 0) {
    // Check if budget strict case
    if (context.budget != null && context.budgetFallback === 'strict') {
      return { error: `No candidate satisfies budget $${context.budget}`, status: 402 };
    }
    // Check vision/tools/context empty
    if (context.hasVision) return { error: 'No vision-capable model available', status: 400 };
    if (context.hasTools) return { error: 'No tool-capable model available', status: 400 };
    if (context.estimatedTotalTokens > 0 || context.estimatedInputTokens > 0) {
      return { error: 'Request too large for available models', status: 413 };
    }
    return { error: 'All candidates filtered for auto routing', status: 503 };
  }

  // Determine incident mode before exploration
  const incident = isIncidentMode(filtered);

  // Self-healing: remove temporarily excluded unless probing
  let eligible = filtered.filter(c => {
    if (isTemporarilyExcluded(c)) {
      // probe recovery: allow one request after cooldown
      if (shouldProbe(c)) return true;
      return false;
    }
    return true;
  });
  if (eligible.length === 0) eligible = filtered; // fail-open

  // Score for self-healing degradation check
  const weights = context.mode ? (getModePackWeights(context.mode) ?? DEFAULT_WEIGHTS) : DEFAULT_WEIGHTS;
  const scoredMap = scorePool(eligible, weights as any, context);
  for (const [c, s] of scoredMap) {
    if (s < 0.2) recordScoreDegradation(c, s);
  }

  // Exploration
  let exploration = false;
  let explorationCandidate: AutoCandidate | null = null;
  if (!incident && shouldExplore(incident)) {
    explorationCandidate = pickExplorationCandidate(eligible, (c) => {
      if (context.budget != null && context.budgetFallback === 'strict' && (c.costPer1MTokens ?? 0) > context.budget!) return false;
      if (context.estimatedTotalTokens > 0 && c.contextWindow != null && context.estimatedTotalTokens > c.contextWindow) return false;
      if (isTemporarilyExcluded(c)) return false;
      return true;
    });
    if (explorationCandidate) exploration = true;
  }

  // Strategy selection
  const strategyName = resolveAutoStrategyName(parsed, context);
  const strategy = getRouterStrategy(strategyName) ?? getRouterStrategy('rules')!;
  let decision: RoutingDecision;
  if (exploration && explorationCandidate) {
    decision = {
      candidate: explorationCandidate,
      strategy: strategyName,
      score: explorationCandidate._finalScore ?? 0.5,
      reason: 'exploration',
      candidatesConsidered: eligible.length,
      exploration: true,
      fallback: false,
    };
  } else {
    decision = strategy.select(eligible, context);
    decision.exploration = false;
  }

  // Update LKGP
  if (context.sessionKey) {
    setLastKnownGood(context.sessionKey, `${decision.candidate.provider}:${decision.candidate.model}`);
  }

  return { decision, candidate: decision.candidate, incidentMode: incident };
}

export function recordRoutingDecision(decision: RoutingDecision, context: RoutingContext, success: boolean, latencyMs?: number): void {
  // Integrate with existing analytics: we log via request-log if needed but don't block
  try {
    // Lightweight structured log
    console.log(`[AutoRouter] decision=${JSON.stringify({
      requestId: context.requestId,
      strategy: decision.strategy,
      variant: context.category ?? context.variant,
      selectedProvider: decision.candidate.provider,
      selectedModel: decision.candidate.model,
      candidatesConsidered: decision.candidatesConsidered,
      score: decision.score,
      reason: decision.reason,
      latencyMs,
      estimatedCost: decision.candidate.costPer1MTokens,
      exploration: decision.exploration,
      fallback: decision.fallback,
      success,
    })}`);
  } catch {}
}

export function getAutoCandidatesForApi(): Array<{
  provider: string;
  model: string;
  available: boolean;
  health: number;
  excluded: boolean;
  reason: string;
}> {
  try {
    const dbCtx: RoutingContext = {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 512,
      estimatedTotalTokens: 612,
      hasTools: false,
      hasVision: false,
    };
    const pool = buildCandidatePool(dbCtx);
    return pool.map(c => ({
      provider: c.provider,
      model: c.model,
      available: c.circuitBreakerState !== 'OPEN' && !isTemporarilyExcluded(c),
      health: c.healthScore ?? 0.5,
      excluded: isTemporarilyExcluded(c) || c.circuitBreakerState === 'OPEN',
      reason: c.circuitBreakerState === 'OPEN' ? 'circuit OPEN' : isTemporarilyExcluded(c) ? 'temporarily excluded' : 'eligible',
    }));
  } catch {
    return [];
  }
}
