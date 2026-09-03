import type { AutoScoringWeights, FactorName } from './types.js';

export type ModePackName =
  | 'ship-fast'
  | 'cost-saver'
  | 'quality-first'
  | 'offline-friendly'
  | 'reliability-first'
  | 'chaos-mode'
  | 'fast'
  | 'balanced'
  | 'quality'
  | 'cheap'
  | 'reliable'
  | 'offline';

export const MODE_PACKS: Record<string, Record<FactorName, number>> = {
  'ship-fast': {
    quota: 0.0952,
    health: 0.2667,
    costInv: 0.0476,
    latencyInv: 0.3048,
    taskFit: 0.0952,
    stability: 0.0238,
    tierPriority: 0.0238,
    tierAffinity: 0.0238,
    specificityMatch: 0.0238,
    contextAffinity: 0.0238,
    sessionAvailability: 0.0238,
    connectionDensity: 0.0238,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.0238,
    reliability: 0,
  },
  'cost-saver': {
    quota: 0.0952,
    health: 0.1810,
    costInv: 0.3524,
    latencyInv: 0.0476,
    taskFit: 0.0476,
    stability: 0.0476,
    tierPriority: 0.0476,
    tierAffinity: 0.0476,
    specificityMatch: 0.0238,
    contextAffinity: 0.0238,
    sessionAvailability: 0.0238,
    connectionDensity: 0.0238,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.03,
    reliability: 0,
  },
  'quality-first': {
    quota: 0.0476,
    health: 0.1714,
    costInv: 0.0238,
    latencyInv: 0.0476,
    taskFit: 0.3524,
    stability: 0.1429,
    tierPriority: 0.0476,
    tierAffinity: 0.0476,
    specificityMatch: 0.0476,
    contextAffinity: 0.0476,
    sessionAvailability: 0.0238,
    connectionDensity: 0.0238,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.03,
    reliability: 0,
  },
  'offline-friendly': {
    quota: 0.3524,
    health: 0.2667,
    costInv: 0.0476,
    latencyInv: 0.0238,
    taskFit: 0.0476,
    stability: 0.0476,
    tierPriority: 0.0238,
    tierAffinity: 0.0238,
    specificityMatch: 0.0238,
    contextAffinity: 0.0476,
    sessionAvailability: 0.0476,
    connectionDensity: 0.0476,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.0238,
    reliability: 0,
  },
  'reliability-first': {
    quota: 0.0476,
    health: 0.3524,
    costInv: 0.0238,
    latencyInv: 0.0476,
    taskFit: 0.0476,
    stability: 0.1905,
    tierPriority: 0.0476,
    tierAffinity: 0.0476,
    specificityMatch: 0.0238,
    contextAffinity: 0.0238,
    sessionAvailability: 0.0476,
    connectionDensity: 0.0476,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.03,
    reliability: 0.0476,
  },
  'chaos-mode': {
    quota: 0.0476,
    health: 0.4000,
    costInv: 0.0238,
    latencyInv: 0.0476,
    taskFit: 0.1905,
    stability: 0.0476,
    tierPriority: 0.0476,
    tierAffinity: 0.0476,
    specificityMatch: 0.0476,
    contextAffinity: 0.0476,
    sessionAvailability: 0.0238,
    connectionDensity: 0.0238,
    cacheAffinity: 0,
    resetWindowAffinity: 0,
    quality: 0.03,
    reliability: 0.0238,
  },
};

export const MODE_ALIASES: Record<string, string> = {
  fast: 'ship-fast',
  balanced: 'ship-fast',
  quality: 'quality-first',
  cheap: 'cost-saver',
  reliable: 'reliability-first',
  offline: 'offline-friendly',
  'ship-fast': 'ship-fast',
  'cost-saver': 'cost-saver',
  'quality-first': 'quality-first',
  'offline-friendly': 'offline-friendly',
  'reliability-first': 'reliability-first',
  'chaos-mode': 'chaos-mode',
};

export function getModePackWeights(mode: string | undefined): Record<FactorName, number> | null {
  if (!mode) return null;
  const key = MODE_ALIASES[mode.toLowerCase()] ?? mode.toLowerCase();
  const pack = MODE_PACKS[key];
  return pack ?? null;
}
