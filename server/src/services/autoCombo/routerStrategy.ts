import type { AutoCandidate, RoutingContext, RoutingDecision } from './types.js';

export interface RouterStrategy {
  readonly name: string;
  readonly description: string;
  select(pool: AutoCandidate[], context: RoutingContext): RoutingDecision;
}

const registry = new Map<string, RouterStrategy>();

export function registerRouterStrategy(name: string, strategy: RouterStrategy): void {
  registry.set(name.toLowerCase(), strategy);
}

export function getRouterStrategy(name: string): RouterStrategy | undefined {
  return registry.get(name.toLowerCase());
}

export function listRouterStrategies(): string[] {
  return [...registry.keys()];
}
