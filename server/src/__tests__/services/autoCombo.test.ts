import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { parseAutoPrefix, isAutoModel } from '../../services/autoCombo/parser.js';
import { normalizeScoringWeights, DEFAULT_WEIGHTS } from '../../services/autoCombo/types.js';
import { scoreCandidate, scorePool, computeFactorScores } from '../../services/autoCombo/scoring.js';
import { getModePackWeights } from '../../services/autoCombo/modePacks.js';
import { selectAutoCandidate, buildRoutingContext } from '../../services/autoCombo/engine.js';
import { buildCandidatePool } from '../../services/autoCombo/candidateFactory.js';
import { filterCandidates } from '../../services/autoCombo/candidateFilter.js';
import { isIncidentMode, recordScoreDegradation, isTemporarilyExcluded, resetSelfHealing } from '../../services/autoCombo/selfHealing.js';
import { setExplorationRate, getExplorationRate, shouldExplore, pickExplorationCandidate } from '../../services/autoCombo/exploration.js';
import type { AutoCandidate, RoutingContext } from '../../services/autoCombo/types.js';

function makeCandidate(overrides: Partial<AutoCandidate> = {}): AutoCandidate {
  const base: AutoCandidate = {
    provider: 'groq',
    model: 'test-model',
    displayName: 'Test Model',
    modelDbId: 1,
    costPer1MTokens: 0.5,
    p95LatencyMs: 500,
    quotaScore: 0.8,
    healthScore: 0.9,
    errorRate: 0.05,
    reliabilityScore: 0.95,
    taskFitScore: 0.5,
    tier: 'standard',
    contextWindow: 131072,
    supportsVision: false,
    supportsTools: true,
    supportsReasoning: false,
    sessionAvailability: 1,
    connectionDensity: 0.5,
    cacheAffinity: 0.5,
    resetWindowAffinity: 0.5,
    quality: 0.5,
    circuitBreakerState: 'CLOSED',
    chainRow: {
      model_db_id: 1,
      priority: 1,
      enabled: 1,
      platform: 'groq',
      model_id: 'test-model',
      display_name: 'Test Model',
      intelligence_rank: 5,
      size_label: 'Medium',
      monthly_token_budget: '~6M',
      rpm_limit: 30,
      rpd_limit: 1000,
      tpm_limit: 6000,
      tpd_limit: null,
      supports_vision: 0,
      supports_tools: 1,
      context_window: 131072,
      key_id: null,
      endpoint_scope: '',
    },
  };
  return { ...base, ...overrides };
}

describe('parseAutoPrefix', () => {
  it('parses auto', () => {
    const p = parseAutoPrefix('auto')!;
    expect(p.isAuto).toBe(true);
    expect(p.isValid).toBe(true);
  });
  it('parses auto/coding', () => {
    const p = parseAutoPrefix('auto/coding')!;
    expect(p.category).toBe('coding');
    expect(p.isValid).toBe(true);
  });
  it('parses auto/fast as tier', () => {
    const p = parseAutoPrefix('auto/fast')!;
    expect(p.tier).toBe('fast');
  });
  it('parses auto/coding:fast', () => {
    const p = parseAutoPrefix('auto/coding:fast')!;
    expect(p.category).toBe('coding');
    expect(p.tier).toBe('fast');
  });
  it('parses auto/reasoning:pro', () => {
    const p = parseAutoPrefix('auto/reasoning:pro')!;
    expect(p.category).toBe('reasoning');
    expect(p.tier).toBe('pro');
  });
  it('returns null for non-auto', () => {
    expect(parseAutoPrefix('gpt-4o')).toBeNull();
  });
  it('fails invalid combination', () => {
    const p = parseAutoPrefix('auto/invalid:xyz')!;
    expect(p.isValid).toBe(false);
  });
  it('handles auto/offline variant', () => {
    const p = parseAutoPrefix('auto/offline')!;
    expect(p.variant).toBe('offline');
    expect(p.isValid).toBe(true);
  });
  it('handles isAutoModel', () => {
    expect(isAutoModel('auto')).toBe(true);
    expect(isAutoModel('auto/coding:fast')).toBe(true);
    expect(isAutoModel('gpt-4o')).toBe(false);
  });
});

describe('normalizeScoringWeights', () => {
  it('normalizes to sum 1', () => {
    const w = normalizeScoringWeights({ quota: 1, health: 1, costInv: 2 });
    const sum = Object.values(w).reduce((a,b)=>a+b,0);
    expect(sum).toBeCloseTo(1);
  });
  it('falls back to defaults on empty', () => {
    const w = normalizeScoringWeights({});
    expect(w.quota).toBe(DEFAULT_WEIGHTS.quota);
  });
});

describe('scoring', () => {
  it('is deterministic for identical inputs', () => {
    const a = makeCandidate({ provider: 'a', model: 'a', p95LatencyMs: 300, costPer1MTokens: 0.2 });
    const b = makeCandidate({ provider: 'b', model: 'b', p95LatencyMs: 800, costPer1MTokens: 1.0 });
    const pool = [a,b];
    const s1 = scoreCandidate(a, pool);
    const s2 = scoreCandidate(a, pool);
    expect(s1).toBe(s2);
  });
  it('cheaper scores higher on costInv', () => {
    const cheap = makeCandidate({ costPer1MTokens: 0.1, p95LatencyMs: 500 });
    const expensive = makeCandidate({ costPer1MTokens: 5, p95LatencyMs: 500 });
    const pool = [cheap, expensive];
    const map = computeFactorScores(pool);
    expect(map.get(cheap)!.costInv).toBeGreaterThan(map.get(expensive)!.costInv);
  });
  it('faster scores higher on latencyInv', () => {
    const fast = makeCandidate({ p95LatencyMs: 200, costPer1MTokens: 0.5 });
    const slow = makeCandidate({ p95LatencyMs: 2000, costPer1MTokens: 0.5 });
    const pool = [fast, slow];
    const map = computeFactorScores(pool);
    expect(map.get(fast)!.latencyInv).toBeGreaterThan(map.get(slow)!.latencyInv);
  });
  it('scorePool returns scores for all', () => {
    const pool = [makeCandidate(), makeCandidate({ provider:'b', model:'b' })];
    const m = scorePool(pool);
    expect(m.size).toBe(2);
  });
});

describe('mode packs', () => {
  it('ship-fast has high latency weight', () => {
    const w = getModePackWeights('ship-fast')!;
    expect(w.latencyInv).toBeGreaterThan(0.2);
  });
  it('cost-saver has high cost weight', () => {
    const w = getModePackWeights('cost-saver')!;
    expect(w.costInv).toBeGreaterThan(0.3);
  });
  it('aliases work', () => {
    expect(getModePackWeights('fast')).toBeTruthy();
    expect(getModePackWeights('cheap')).toBeTruthy();
  });
});

describe('candidate filtering', () => {
  it('fail-open on category with zero matches', () => {
    const pool = [makeCandidate({ provider:'groq', model:'flash' }), makeCandidate({ provider:'groq', model:'mini', displayName:'flash-mini' })];
    // category coding requires coder etc, but pool has no coder -> should fail open to original pool
    const parsed = parseAutoPrefix('auto/coding')!;
    const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 200, estimatedTotalTokens: 300, hasTools:false, hasVision:false, category:'coding' };
    const filtered = filterCandidates(pool, parsed, ctx);
    expect(filtered.length).toBe(pool.length);
  });
  it('hard filters context window', () => {
    const small = makeCandidate({ contextWindow: 1000, provider:'groq', model:'a', chainRow: { ...makeCandidate().chainRow, platform:'groq', model_id:'a' } });
    const large = makeCandidate({ contextWindow: 100000, provider:'groq', model:'b', chainRow: { ...makeCandidate().chainRow, platform:'groq', model_id:'b' } });
    const parsed = parseAutoPrefix('auto')!;
    const ctx: RoutingContext = { estimatedInputTokens: 5000, estimatedOutputTokens: 5000, estimatedTotalTokens: 10000, hasTools:false, hasVision:false };
    const filtered = filterCandidates([small, large], parsed, ctx);
    expect(filtered.length).toBe(1);
    expect(filtered[0].model).toBe('b');
  });
  it('requires vision', () => {
    const noVision = makeCandidate({ supportsVision:false, provider:'groq', model:'a', chainRow: { ...makeCandidate().chainRow, platform:'groq', model_id:'a', supports_vision:0 } });
    const vision = makeCandidate({ supportsVision:true, provider:'groq', model:'b', chainRow: { ...makeCandidate().chainRow, platform:'groq', model_id:'b', supports_vision:1 } });
    const ctx: RoutingContext = { estimatedInputTokens:100, estimatedOutputTokens:100, estimatedTotalTokens:200, hasTools:false, hasVision:true };
    const filtered = filterCandidates([noVision, vision], parseAutoPrefix('auto')!, ctx);
    expect(filtered.length).toBe(1);
    expect(filtered[0].model).toBe('b');
  });
});

describe('self-healing', () => {
  beforeEach(() => resetSelfHealing());
  it('detects incident mode >50% OPEN', () => {
    const open = makeCandidate({ circuitBreakerState:'OPEN', provider:'a', model:'a' });
    const open2 = makeCandidate({ circuitBreakerState:'OPEN', provider:'b', model:'b' });
    const closed = makeCandidate({ circuitBreakerState:'CLOSED', provider:'c', model:'c' });
    expect(isIncidentMode([open, open2, closed])).toBe(true);
    expect(isIncidentMode([open, closed, closed])).toBe(false);
  });
  it('temporarily excludes low score', () => {
    const c = makeCandidate({ provider:'x', model:'y' });
    recordScoreDegradation(c, 0.1);
    expect(isTemporarilyExcluded(c)).toBe(true);
  });
});

describe('exploration', () => {
  it('disabled during incident', () => {
    setExplorationRate(1);
    expect(shouldExplore(true)).toBe(false);
    setExplorationRate(0.05);
  });
  it('picks candidate', () => {
    const pool = [makeCandidate({ provider:'a', model:'a' }), makeCandidate({ provider:'b', model:'b' })];
    const pick = pickExplorationCandidate(pool);
    expect(pick).toBeTruthy();
  });
});

describe('engine integration', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    resetSelfHealing();
    // ensure at least one key
    const k = encrypt('test-key');
    db.prepare(`INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('groq', 'test', k.encrypted, k.iv, k.authTag, 'healthy', 1);
    db.prepare(`INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('google', 'test2', k.encrypted, k.iv, k.authTag, 'healthy', 1);
  });
  it('selects candidate for auto', () => {
    const ctx = buildRoutingContext({ estimatedInputTokens:100, estimatedOutputTokens:200, hasTools:false, hasVision:false, modelString:'auto' });
    const res: any = selectAutoCandidate('auto', ctx);
    expect(res.candidate).toBeDefined();
    expect(res.error).toBeUndefined();
  });
  it('selects candidate for auto/coding', () => {
    const ctx = buildRoutingContext({ estimatedInputTokens:100, estimatedOutputTokens:200, hasTools:false, hasVision:false, modelString:'auto/coding' });
    const res: any = selectAutoCandidate('auto/coding', ctx);
    expect(res.candidate).toBeDefined();
  });
  it('returns 402 on strict budget', () => {
    const ctx = buildRoutingContext({ estimatedInputTokens:100, estimatedOutputTokens:200, hasTools:false, hasVision:false, modelString:'auto', budget:0.001, budgetFallback:'strict' });
    const res: any = selectAutoCandidate('auto', ctx);
    expect(res.status).toBe(402);
  });
  it('builds pool dynamically', () => {
    const ctx: RoutingContext = { estimatedInputTokens:100, estimatedOutputTokens:100, estimatedTotalTokens:200, hasTools:false, hasVision:false };
    const pool = buildCandidatePool(ctx);
    expect(pool.length).toBeGreaterThan(0);
  });
});
