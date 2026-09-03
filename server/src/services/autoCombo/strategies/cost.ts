import type { RouterStrategy } from '../routerStrategy.js';
import type { AutoCandidate, RoutingContext, RoutingDecision } from '../types.js';

export class CostStrategy implements RouterStrategy {
  readonly name = 'cost';
  readonly description = 'Select cheapest healthy candidate';
  select(pool: AutoCandidate[], _context: RoutingContext): RoutingDecision {
    const healthy = pool.filter(c => c.circuitBreakerState !== 'OPEN');
    const candidates = healthy.length ? healthy : pool;
    let best = candidates[0];
    for (const c of candidates) {
      if ((c.costPer1MTokens ?? Infinity) < (best.costPer1MTokens ?? Infinity)) best = c;
    }
    return {
      candidate: best,
      strategy: this.name,
      score: 1 - Math.min(1, (best.costPer1MTokens ?? 0) / 10),
      reason: 'cheapest candidate',
      candidatesConsidered: pool.length,
      exploration: false,
      fallback: false,
    };
  }
}
export class EcoStrategy implements RouterStrategy {
  readonly name = 'eco';
  readonly description = 'Eco - cheapest healthy candidate (alias of cost)';
  select(pool: AutoCandidate[], _context: RoutingContext): RoutingDecision {
    return new CostStrategy().select(pool, _context);
  }
}
