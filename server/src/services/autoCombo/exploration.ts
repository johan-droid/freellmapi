import type { AutoCandidate } from './types.js';

export const DEFAULT_EXPLORATION_RATE = 0.05;

let explorationRate = DEFAULT_EXPLORATION_RATE;

export function setExplorationRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('Exploration rate must be 0..1');
  explorationRate = rate;
}

export function getExplorationRate(): number {
  return explorationRate;
}

export function shouldExplore(isIncident: boolean): boolean {
  if (isIncident) return false;
  return Math.random() < explorationRate;
}

export function pickExplorationCandidate(pool: AutoCandidate[], eligibleFilter?: (c: AutoCandidate) => boolean): AutoCandidate | null {
  const eligible = pool.filter(c => {
    if (c.circuitBreakerState === 'OPEN') return false;
    if (eligibleFilter && !eligibleFilter(c)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx] ?? null;
}
