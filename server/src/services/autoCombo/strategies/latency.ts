import type { RouterStrategy } from '../routerStrategy.js';
import type { AutoCandidate, RoutingContext, RoutingDecision } from '../types.js';

export class LatencyStrategy implements RouterStrategy {
  readonly name = 'latency';
  readonly description = 'Select lowest effective latency (p95 + errorRate*penalty)';
  private penaltyMs = 5000;
  select(pool: AutoCandidate[], _context: RoutingContext): RoutingDecision {
    const healthy = pool.filter(c => c.circuitBreakerState !== 'OPEN');
    const candidates = healthy.length ? healthy : pool;
    let best = candidates[0];
    let bestEff = (best.p95LatencyMs ?? 1500) + (best.errorRate ?? 0) * this.penaltyMs;
    for (const c of candidates) {
      const eff = (c.p95LatencyMs ?? 1500) + (c.errorRate ?? 0) * this.penaltyMs;
      if (eff < bestEff) { bestEff = eff; best = c; }
    }
    return {
      candidate: best,
      strategy: this.name,
      score: 1 - Math.min(1, bestEff / 10000),
      reason: 'lowest effective latency',
      candidatesConsidered: pool.length,
      exploration: false,
      fallback: false,
    };
  }
}
export class FastStrategy implements RouterStrategy {
  readonly name = 'fast';
  readonly description = 'Fast - lowest effective latency (alias of latency)';
  select(pool: AutoCandidate[], _context: RoutingContext): RoutingDecision {
    return new LatencyStrategy().select(pool, _context);
  }
}
