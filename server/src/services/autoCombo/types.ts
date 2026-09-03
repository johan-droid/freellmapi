import type { ChainRow } from '../router.js';

export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export interface AutoCandidate {
  provider: string;
  model: string;
  displayName: string;
  modelDbId: number;
  connectionId?: string;
  endpointScope?: string;
  infrastructureGroup?: string;
  providerType?: string;

  costPer1MTokens: number;
  inputCost?: number;
  outputCost?: number;

  p95LatencyMs: number;
  latencyStdDev?: number;

  quotaScore: number; // 0..1 headroom
  healthScore: number; // 0..1

  errorRate: number; // 0..1
  reliabilityScore: number; // 1 - errorRate

  taskFitScore: number; // 0..1

  tier?: 'free' | 'standard' | 'pro' | 'ultra';

  contextWindow?: number | null;
  maxOutputTokens?: number | null;

  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsReasoning?: boolean;

  sessionAvailability?: number; // 0..1
  connectionDensity?: number; // 0..1 lower is better? we normalize
  cacheAffinity?: number;
  resetWindowAffinity?: number;
  quality?: number; // 0..1
  circuitBreakerState?: CircuitState;

  lastKnownGood?: boolean;

  // raw row for routing execution
  chainRow: ChainRow;

  // internal scores computed
  _rawScores?: Record<string, number>;
  _finalScore?: number;
}

export interface ModelCapabilities {
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  tier?: string;
  inputCost?: number;
  outputCost?: number;
}

export interface RoutingContext {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  hasTools: boolean;
  hasVision: boolean;
  requiresReasoning?: boolean;
  category?: string;
  tier?: string;
  variant?: string;
  budget?: number | null;
  budgetFallback?: 'cheapest' | 'strict';
  mode?: string;
  slaTargetP95Ms?: number;
  slaMaxErrorRate?: number;
  slaMaxCostPer1MTokens?: number;
  slaHardConstraints?: boolean;
  requestId?: string;
  sessionKey?: string;
}

export interface RoutingDecision {
  candidate: AutoCandidate;
  strategy: string;
  variant?: string;
  score: number;
  reason: string;
  candidatesConsidered: number;
  exploration: boolean;
  fallback: boolean;
  alternatives?: AutoCandidate[];
}

export type AutoScoringWeights = Record<string, number>;

export const FACTORS = [
  'quota',
  'health',
  'costInv',
  'latencyInv',
  'taskFit',
  'stability',
  'tierPriority',
  'tierAffinity',
  'specificityMatch',
  'contextAffinity',
  'sessionAvailability',
  'connectionDensity',
  'cacheAffinity',
  'resetWindowAffinity',
  'quality',
  'reliability',
] as const;

export type FactorName = typeof FACTORS[number];

export const DEFAULT_WEIGHTS: Record<FactorName, number> = {
  quota: 0.1429,
  health: 0.1605,
  costInv: 0.1429,
  latencyInv: 0.1143,
  taskFit: 0.0762,
  stability: 0.0476,
  tierPriority: 0.0476,
  tierAffinity: 0.0476,
  specificityMatch: 0.0476,
  contextAffinity: 0.0476,
  sessionAvailability: 0.0476,
  connectionDensity: 0.0476,
  cacheAffinity: 0,
  resetWindowAffinity: 0,
  quality: 0.03,
  reliability: 0,
};

export function normalizeScoringWeights(weights: Record<string, number>): Record<FactorName, number> {
  const normalized: Record<string, number> = {};
  let sum = 0;
  let hasAny = false;
  for (const f of FACTORS) {
    const v = weights[f];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      normalized[f] = v;
      sum += v;
      if (v > 0) hasAny = true;
    } else {
      normalized[f] = 0;
    }
  }
  if (!hasAny || sum <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  const result: Record<string, number> = {} as any;
  for (const f of FACTORS) {
    result[f] = (normalized[f] ?? 0) / sum;
  }
  return result as Record<FactorName, number>;
}
