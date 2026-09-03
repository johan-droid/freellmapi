import type { RouterStrategy } from '../routerStrategy.js';
import type { AutoCandidate, RoutingContext, RoutingDecision } from '../types.js';
import { scorePool } from '../scoring.js';
import { DEFAULT_WEIGHTS } from '../types.js';

export class SlaStrategy implements RouterStrategy {
  readonly name = 'sla-aware';
  readonly description = 'SLA-aware: respect SLO targets, hard constraints when enabled';
  select(pool: AutoCandidate[], context: RoutingContext): RoutingDecision {
    const targetMs = context.slaTargetP95Ms;
    const maxErr = context.slaMaxErrorRate;
    const maxCost = context.slaMaxCostPer1MTokens;
    const hard = context.slaHardConstraints;

    let candidates = [...pool];
    if (hard) {
      candidates = candidates.filter(c => {
        if (targetMs != null && (c.p95LatencyMs ?? 0) > targetMs) return false;
        if (maxErr != null && (c.errorRate ?? 0) > maxErr) return false;
        if (maxCost != null && (c.costPer1MTokens ?? 0) > maxCost) return false;
        return true;
      });
      if (candidates.length === 0) {
        // fall back to pool but will be deprioritized
        candidates = [...pool];
      }
    }
    // Score remaining, but deprioritize violators
    const weights = DEFAULT_WEIGHTS;
    const scored = scorePool(candidates, weights as any, context);
    // Apply penalty for SLO violations when not hard
    let best: AutoCandidate | null = null;
    let bestScore = -1;
    for (const [c, baseScore] of scored) {
      let s = baseScore;
      if (!hard) {
        if (targetMs != null && (c.p95LatencyMs ?? 0) > targetMs) s *= 0.5;
        if (maxErr != null && (c.errorRate ?? 0) > maxErr) s *= 0.5;
        if (maxCost != null && (c.costPer1MTokens ?? 0) > maxCost) s *= 0.5;
      }
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) throw new Error('No candidate in sla strategy');
    return {
      candidate: best,
      strategy: this.name,
      score: bestScore,
      reason: hard ? 'best candidate respecting hard SLOs' : 'best candidate with SLO penalty',
      candidatesConsidered: pool.length,
      exploration: false,
      fallback: false,
    };
  }
}
export class SlaHardStrategy implements RouterStrategy {
  readonly name = 'sla';
  readonly description = 'SLA (hard) alias';
  select(pool: AutoCandidate[], _context: RoutingContext): RoutingDecision {
    return new SlaStrategy().select(pool, _context);
  }
}
