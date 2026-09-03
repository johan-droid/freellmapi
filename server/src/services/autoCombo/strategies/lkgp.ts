import type { RouterStrategy } from '../routerStrategy.js';
import type { AutoCandidate, RoutingContext, RoutingDecision } from '../types.js';
import { getLastKnownGood } from '../selfHealing.js';
import { RulesStrategy } from './rules.js';

export class LkgpStrategy implements RouterStrategy {
  readonly name = 'lkgp';
  readonly description = 'Last-Known-Good Provider first, fallback to rules';

  select(pool: AutoCandidate[], context: RoutingContext): RoutingDecision {
    const lkgpKey = context.sessionKey ? getLastKnownGood(context.sessionKey) : undefined;
    // Also check candidate lastKnownGood flag
    if (lkgpKey) {
      const found = pool.find(c => `${c.provider}:${c.model}` === lkgpKey && c.circuitBreakerState !== 'OPEN' && (c.healthScore ?? 0) > 0.1);
      if (found) {
        return {
          candidate: found,
          strategy: this.name,
          score: found._finalScore ?? 0.8,
          reason: 'last-known-good hit',
          candidatesConsidered: pool.length,
          exploration: false,
          fallback: false,
        };
      }
    }
    // Check per-candidate LKGP flag
    const flagged = pool.find(c => c.lastKnownGood && c.circuitBreakerState !== 'OPEN');
    if (flagged) {
      return {
        candidate: flagged,
        strategy: this.name,
        score: flagged._finalScore ?? 0.8,
        reason: 'last-known-good candidate',
        candidatesConsidered: pool.length,
        exploration: false,
        fallback: false,
      };
    }
    // fallback to rules
    const rules = new RulesStrategy();
    const decision = rules.select(pool, context);
    return { ...decision, strategy: this.name, reason: decision.reason + ' (lkgp miss → rules)' };
  }
}
