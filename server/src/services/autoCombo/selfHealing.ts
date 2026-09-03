import type { AutoCandidate } from './types.js';

const exclusionMap = new Map<string, { until: number; attempts: number }>();
const lastKnownGoodMap = new Map<string, string>(); // sessionKey -> provider:model
const inFlightProbes = new Set<string>();

export const BACKOFF_STEPS = [5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000, 30 * 60 * 1000];
const MAX_EXCLUSION_MS = 30 * 60 * 1000;

function keyFor(c: AutoCandidate | string): string {
  if (typeof c === 'string') return c;
  return `${c.provider}:${c.model}`;
}

export function isTemporarilyExcluded(candidate: AutoCandidate, now = Date.now()): boolean {
  const k = keyFor(candidate);
  const entry = exclusionMap.get(k);
  if (!entry) return false;
  if (now >= entry.until) {
    exclusionMap.delete(k);
    return false;
  }
  return true;
}

export function recordScoreDegradation(candidate: AutoCandidate, score: number, now = Date.now()): void {
  if (score >= 0.2) return;
  const k = keyFor(candidate);
  const existing = exclusionMap.get(k);
  const attempts = (existing?.attempts ?? 0) + 1;
  const step = Math.min(attempts - 1, BACKOFF_STEPS.length - 1);
  const duration = Math.min(BACKOFF_STEPS[step] ?? MAX_EXCLUSION_MS, MAX_EXCLUSION_MS);
  exclusionMap.set(k, { until: now + duration, attempts });
}

export function recordProbeResult(candidate: AutoCandidate, success: boolean, now = Date.now()): void {
  const k = keyFor(candidate);
  if (success) {
    exclusionMap.delete(k);
    inFlightProbes.delete(k);
  } else {
    const existing = exclusionMap.get(k);
    const attempts = (existing?.attempts ?? 0) + 1;
    const step = Math.min(attempts - 1, BACKOFF_STEPS.length - 1);
    const duration = Math.min(BACKOFF_STEPS[step] ?? MAX_EXCLUSION_MS, MAX_EXCLUSION_MS);
    exclusionMap.set(k, { until: now + duration, attempts });
    inFlightProbes.delete(k);
  }
}

export function shouldProbe(candidate: AutoCandidate, now = Date.now()): boolean {
  const k = keyFor(candidate);
  const entry = exclusionMap.get(k);
  if (!entry) return false;
  if (now < entry.until) return false;
  if (inFlightProbes.has(k)) return false;
  inFlightProbes.add(k);
  return true;
}

// Incident mode: >50% OPEN
export function isIncidentMode(pool: AutoCandidate[]): boolean {
  if (pool.length === 0) return false;
  const openCount = pool.filter(c => c.circuitBreakerState === 'OPEN').length;
  return openCount / pool.length > 0.5;
}

// Last-known-good

export function setLastKnownGood(sessionKey: string, providerModel: string): void {
  if (!sessionKey) return;
  lastKnownGoodMap.set(sessionKey, providerModel);
}

export function getLastKnownGood(sessionKey: string): string | undefined {
  return lastKnownGoodMap.get(sessionKey);
}

export function clearLastKnownGood(sessionKey: string): void {
  lastKnownGoodMap.delete(sessionKey);
}

// For testing
export function resetSelfHealing(): void {
  exclusionMap.clear();
  lastKnownGoodMap.clear();
  inFlightProbes.clear();
}

export function getExclusionState(): Map<string, { until: number; attempts: number }> {
  return new Map(exclusionMap);
}
