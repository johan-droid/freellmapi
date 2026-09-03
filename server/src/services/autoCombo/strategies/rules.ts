import type { AutoCandidate, RoutingContext, RoutingDecision } from '../types.js';
import type { RouterStrategy } from '../routerStrategy.js';
import { scorePool } from '../scoring.js';
import { getModePackWeights } from '../modePacks.js';
import { DEFAULT_WEIGHTS } from '../types.js';

export class RulesStrategy implements RouterStrategy {
  readonly name = 'rules';
  readonly description = 'Default 16-factor weighted scoring engine';

  select(pool: AutoCandidate[], context: RoutingContext): RoutingDecision {
    let weights: Record<string, number> = DEFAULT_WEIGHTS as any;
    if (context.mode) {
      const pack = getModePackWeights(context.mode);
      if (pack) weights = pack as any;
    }
    // SLA or custom weights could override
    const scored = scorePool(pool, weights, context);
    let best: AutoCandidate | null = null;
    let bestScore = -1;
    for (const [c, s] of scored) {
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best) throw new Error('No candidate in rules strategy');
    return {
      candidate: best,
      strategy: this.name,
      score: bestScore,
      reason: 'highest weighted score',
      candidatesConsidered: pool.length,
      exploration: false,
      fallback: false,
    };
  }
}
