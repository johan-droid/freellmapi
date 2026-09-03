import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseAutoPrefix, isAutoModel } from '../../services/autoCombo/parser.js';
import { normalizeScoringWeights, scoreCandidate, scorePool, computeFactorScores } from '../../services/autoCombo/scoring.js';
import { filterCandidates } from '../../services/autoCombo/candidateFilter.js';
import { getModePackWeights } from '../../services/autoCombo/modePacks.js';
import { registerRouterStrategy, getRouterStrategy, listRouterStrategies, type RouterStrategy } from '../../services/autoCombo/routerStrategy.js';
import { buildRoutingContext, selectAutoCandidate, resolveAutoStrategyName, ensureStrategies } from '../../services/autoCombo/engine.js';
import { isIncidentMode, isTemporarilyExcluded, recordScoreDegradation, recordProbeResult, shouldProbe, setLastKnownGood, getLastKnownGood, resetSelfHealing } from '../../services/autoCombo/selfHealing.js';
import { setExplorationRate, getExplorationRate, shouldExplore, pickExplorationCandidate } from '../../services/autoCombo/exploration.js';
import { parseRequestControls } from '../../services/autoCombo/requestControls.js';
import type { AutoCandidate, RoutingContext } from '../../services/autoCombo/types.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { createApp } from '../../app.js';
import type { Express } from 'express';

function makeDummyCandidate(overrides: Partial<AutoCandidate> = {}): AutoCandidate {
  return {
    provider: 'groq',
    model: 'llama-3.3-70b',
    displayName: 'Llama 3.3 70B',
    modelDbId: 1,
    costPer1MTokens: 0.5,
    p95LatencyMs: 400,
    latencyStdDev: 50,
    quotaScore: 0.9,
    healthScore: 1.0,
    errorRate: 0.02,
    reliabilityScore: 0.98,
    taskFitScore: 0.8,
    tier: 'standard',
    contextWindow: 128000,
    supportsVision: false,
    supportsTools: true,
    supportsReasoning: false,
    sessionAvailability: 1.0,
    connectionDensity: 0.2,
    circuitBreakerState: 'CLOSED',
    chainRow: {
      model_db_id: 1,
      priority: 1,
      enabled: 1,
      platform: 'groq',
      model_id: 'llama-3.3-70b',
      display_name: 'Llama 3.3 70B',
      intelligence_rank: 5,
      size_label: 'Medium',
      monthly_token_budget: '~1M',
      rpm_limit: 30,
      rpd_limit: 1000,
      tpm_limit: 50000,
      tpd_limit: 500000,
      supports_vision: 0,
      supports_tools: 1,
      context_window: 128000,
      key_id: 1,
      endpoint_scope: '',
    },
    ...overrides,
  };
}

describe('Intelligent Auto-Combo Routing Engine Test Suite', () => {

  describe('1. Parser & Prefix Parsing (parseAutoPrefix)', () => {
    it('parses "auto" correctly', () => {
      const p = parseAutoPrefix('auto')!;
      expect(p.isAuto).toBe(true);
      expect(p.isValid).toBe(true);
      expect(p.category).toBeUndefined();
      expect(p.tier).toBeUndefined();
    });

    it('parses simple categories: auto/coding, auto/reasoning, auto/vision, auto/chat', () => {
      expect(parseAutoPrefix('auto/coding')!.category).toBe('coding');
      expect(parseAutoPrefix('auto/reasoning')!.category).toBe('reasoning');
      expect(parseAutoPrefix('auto/vision')!.category).toBe('vision');
      expect(parseAutoPrefix('auto/chat')!.category).toBe('chat');
    });

    it('parses simple tiers: auto/fast, auto/cheap, auto/reliable, auto/free, auto/pro', () => {
      expect(parseAutoPrefix('auto/fast')!.tier).toBe('fast');
      expect(parseAutoPrefix('auto/cheap')!.tier).toBe('cheap');
      expect(parseAutoPrefix('auto/reliable')!.tier).toBe('reliable');
      expect(parseAutoPrefix('auto/free')!.tier).toBe('free');
      expect(parseAutoPrefix('auto/pro')!.tier).toBe('pro');
    });

    it('parses standalone variants: auto/offline, auto/smart, auto/lkgp', () => {
      expect(parseAutoPrefix('auto/offline')!.variant).toBe('offline');
      expect(parseAutoPrefix('auto/smart')!.variant).toBe('smart');
      expect(parseAutoPrefix('auto/lkgp')!.variant).toBe('lkgp');
    });

    it('parses composable auto/<category>:<tier>', () => {
      const p1 = parseAutoPrefix('auto/coding:fast')!;
      expect(p1.category).toBe('coding');
      expect(p1.tier).toBe('fast');

      const p2 = parseAutoPrefix('auto/reasoning:pro')!;
      expect(p2.category).toBe('reasoning');
      expect(p2.tier).toBe('pro');

      const p3 = parseAutoPrefix('auto/vision:cheap')!;
      expect(p3.category).toBe('vision');
      expect(p3.tier).toBe('cheap');

      const p4 = parseAutoPrefix('auto/multimodal:free')!;
      expect(p4.category).toBe('multimodal');
      expect(p4.tier).toBe('free');
    });

    it('rejects invalid auto strings safely', () => {
      expect(parseAutoPrefix('gpt-4o')).toBeNull();
      const invalid = parseAutoPrefix('auto/invalid:unknown')!;
      expect(invalid.isAuto).toBe(true);
      expect(invalid.isValid).toBe(false);
    });

    it('identifies auto models via isAutoModel', () => {
      expect(isAutoModel('auto')).toBe(true);
      expect(isAutoModel('auto/coding:fast')).toBe(true);
      expect(isAutoModel('claude-3-5-sonnet')).toBe(false);
    });
  });

  describe('2. Weight Normalization & Scoring Engine', () => {
    it('normalizes custom weight maps correctly', () => {
      const custom = { quota: 2, health: 2, costInv: 4, latencyInv: 2 };
      const norm = normalizeScoringWeights(custom);
      expect(norm.costInv).toBeCloseTo(0.4);
      expect(norm.quota).toBeCloseTo(0.2);
      expect(norm.health).toBeCloseTo(0.2);
      expect(norm.latencyInv).toBeCloseTo(0.2);
    });

    it('is deterministic for identical candidate inputs', () => {
      const c1 = makeDummyCandidate({ modelDbId: 1, costPer1MTokens: 1.0, p95LatencyMs: 500 });
      const c2 = makeDummyCandidate({ modelDbId: 2, costPer1MTokens: 0.2, p95LatencyMs: 200 });
      const pool = [c1, c2];
      const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 500, estimatedTotalTokens: 600, hasTools: false, hasVision: false };

      const scoreA1 = scoreCandidate(c1, pool, undefined, ctx);
      const scoreA2 = scoreCandidate(c1, pool, undefined, ctx);
      expect(scoreA1).toEqual(scoreA2);

      const scoreB1 = scoreCandidate(c2, pool, undefined, ctx);
      expect(scoreB1).toBeGreaterThan(scoreA1); // c2 is cheaper & faster
    });

    it('evaluates all 16 factors in computeFactorScores', () => {
      const c = makeDummyCandidate();
      const map = computeFactorScores([c]);
      const scores = map.get(c)!;
      expect(scores).toHaveProperty('quota');
      expect(scores).toHaveProperty('health');
      expect(scores).toHaveProperty('costInv');
      expect(scores).toHaveProperty('latencyInv');
      expect(scores).toHaveProperty('taskFit');
      expect(scores).toHaveProperty('stability');
      expect(scores).toHaveProperty('tierPriority');
      expect(scores).toHaveProperty('tierAffinity');
      expect(scores).toHaveProperty('specificityMatch');
      expect(scores).toHaveProperty('contextAffinity');
      expect(scores).toHaveProperty('sessionAvailability');
      expect(scores).toHaveProperty('connectionDensity');
      expect(scores).toHaveProperty('cacheAffinity');
      expect(scores).toHaveProperty('resetWindowAffinity');
      expect(scores).toHaveProperty('quality');
      expect(scores).toHaveProperty('reliability');
    });
  });

  describe('3. Hard Constraints & Candidate Filtering', () => {
    it('filters out candidates exceeding request context window', () => {
      const smallWindow = makeDummyCandidate({ contextWindow: 4000 });
      const largeWindow = makeDummyCandidate({ contextWindow: 128000 });
      const pool = [smallWindow, largeWindow];

      const ctx: RoutingContext = { estimatedInputTokens: 5000, estimatedOutputTokens: 1000, estimatedTotalTokens: 6000, hasTools: false, hasVision: false };
      const filtered = filterCandidates(pool, null, ctx);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.contextWindow).toBe(128000);
    });

    it('filters non-vision candidates when request requires vision', () => {
      const noVision = makeDummyCandidate({ supportsVision: false });
      const vision = makeDummyCandidate({ supportsVision: true });
      const pool = [noVision, vision];

      const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: false, hasVision: true };
      const filtered = filterCandidates(pool, null, ctx);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.supportsVision).toBe(true);
    });

    it('filters non-tool candidates when request requires tools', () => {
      const noTools = makeDummyCandidate({ supportsTools: false });
      const tools = makeDummyCandidate({ supportsTools: true });
      const pool = [noTools, tools];

      const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: true, hasVision: false };
      const filtered = filterCandidates(pool, null, ctx);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.supportsTools).toBe(true);
    });

    it('filters OPEN circuit breaker candidates', () => {
      const open = makeDummyCandidate({ circuitBreakerState: 'OPEN' });
      const closed = makeDummyCandidate({ circuitBreakerState: 'CLOSED' });
      const pool = [open, closed];

      const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: false, hasVision: false };
      const filtered = filterCandidates(pool, null, ctx);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.circuitBreakerState).toBe('CLOSED');
    });

    it('fails open when category/tier filter produces zero matches', () => {
      const standard = makeDummyCandidate({ tier: 'standard', p95LatencyMs: 1500 });
      const pool = [standard];
      const parsed = parseAutoPrefix('auto/coding:free')!; // no candidate is free tier

      const ctx: RoutingContext = { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: false, hasVision: false };
      const filtered = filterCandidates(pool, parsed, ctx);
      expect(filtered).toHaveLength(1); // failed open to standard candidate
    });
  });

  describe('4. Mode Packs & Routing Strategies', () => {
    it('retrieves explicit factor weights for mode packs', () => {
      const shipFast = getModePackWeights('ship-fast')!;
      expect(shipFast.latencyInv).toBeGreaterThan(0.2);

      const costSaver = getModePackWeights('cost-saver')!;
      expect(costSaver.costInv).toBeGreaterThan(0.3);

      const qualityFirst = getModePackWeights('quality-first')!;
      expect(qualityFirst.taskFit).toBeGreaterThan(0.3);
    });

    it('executes cost strategy to select cheapest candidate', () => {
      ensureStrategies();
      const cheap = makeDummyCandidate({ costPer1MTokens: 0.1 });
      const expensive = makeDummyCandidate({ costPer1MTokens: 5.0 });
      const pool = [expensive, cheap];

      const strategy = getRouterStrategy('cost')!;
      const decision = strategy.select(pool, { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: false, hasVision: false });
      expect(decision.candidate.costPer1MTokens).toBe(0.1);
    });

    it('executes latency strategy to select fastest candidate', () => {
      ensureStrategies();
      const fast = makeDummyCandidate({ p95LatencyMs: 150, errorRate: 0.01 });
      const slow = makeDummyCandidate({ p95LatencyMs: 1200, errorRate: 0.01 });
      const pool = [slow, fast];

      const strategy = getRouterStrategy('latency')!;
      const decision = strategy.select(pool, { estimatedInputTokens: 100, estimatedOutputTokens: 100, estimatedTotalTokens: 200, hasTools: false, hasVision: false });
      expect(decision.candidate.p95LatencyMs).toBe(150);
    });

    it('allows custom strategy registration', () => {
      class CustomTestStrategy implements RouterStrategy {
        readonly name = 'custom-test';
        readonly description = 'Custom test strategy';
        select(pool: AutoCandidate[]) {
          return { candidate: pool[0]!, strategy: 'custom-test', score: 1, reason: 'test', candidatesConsidered: pool.length, exploration: false, fallback: false };
        }
      }
      registerRouterStrategy('custom-test', new CustomTestStrategy());
      expect(getRouterStrategy('custom-test')).toBeDefined();
      expect(listRouterStrategies()).toContain('custom-test');
    });
  });

  describe('5. Self-Healing, Backoff & Incident Mode', () => {
    beforeEach(() => {
      resetSelfHealing();
    });

    it('detects incident mode when >50% of candidate pool is OPEN', () => {
      const open1 = makeDummyCandidate({ circuitBreakerState: 'OPEN' });
      const open2 = makeDummyCandidate({ circuitBreakerState: 'OPEN' });
      const closed = makeDummyCandidate({ circuitBreakerState: 'CLOSED' });

      expect(isIncidentMode([open1, open2, closed])).toBe(true);
      expect(isIncidentMode([open1, closed])).toBe(false);
    });

    it('temporarily excludes candidate with score degradation (<0.2) and applies backoff', () => {
      const c = makeDummyCandidate();
      const now = Date.now();
      expect(isTemporarilyExcluded(c, now)).toBe(false);

      recordScoreDegradation(c, 0.1, now);
      expect(isTemporarilyExcluded(c, now + 1000)).toBe(true);
    });

    it('allows probe recovery after cooldown', () => {
      const c = makeDummyCandidate();
      const now = Date.now();
      recordScoreDegradation(c, 0.1, now);

      // Probe disallowed during exclusion period
      expect(shouldProbe(c, now + 1000)).toBe(false);

      // Probe allowed after 5 min backoff
      const afterCooldown = now + 6 * 60 * 1000;
      expect(isTemporarilyExcluded(c, afterCooldown)).toBe(false);
    });

    it('maintains Last-Known-Good Provider session mapping', () => {
      const sessionKey = 'user-sess-123';
      setLastKnownGood(sessionKey, 'groq:llama-3.3-70b');
      expect(getLastKnownGood(sessionKey)).toBe('groq:llama-3.3-70b');
    });
  });

  describe('6. Exploration / Bandit Control', () => {
    it('disables exploration during incident mode', () => {
      setExplorationRate(0.5);
      expect(shouldExplore(true)).toBe(false);
    });

    it('respects exploration rate setting', () => {
      setExplorationRate(0.0);
      expect(getExplorationRate()).toBe(0.0);
      expect(shouldExplore(false)).toBe(false);

      setExplorationRate(1.0);
      expect(shouldExplore(false)).toBe(true);
      setExplorationRate(0.05); // restore default
    });
  });

  describe('7. Per-Request Controls Parsing', () => {
    it('parses X-FreeLLMAPI headers cleanly', () => {
      const req: any = {
        headers: {
          'x-freellmapi-mode': 'fast',
          'x-freellmapi-budget': '0.05',
          'x-freellmapi-budget-fallback': 'strict',
          'x-freellmapi-sla-p95': '1000',
        },
      };
      const controls = parseRequestControls(req);
      expect(controls.mode).toBe('fast');
      expect(controls.budget).toBe(0.05);
      expect(controls.budgetFallback).toBe('strict');
      expect(controls.slaTargetP95Ms).toBe(1000);
    });
  });

  describe('8. Integration & Database Overrides Endpoints', () => {
    let app: Express;

    beforeEach(() => {
      process.env.ENCRYPTION_KEY = '0'.repeat(64);
      initDb(':memory:');
      app = createApp();
      const db = getDb();
      db.prepare('DELETE FROM fallback_config').run();
      db.prepare('DELETE FROM profile_models').run();
      db.prepare('DELETE FROM models').run();
      // Insert healthy key and models
      const secret = encrypt('test-key');
      db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES ('groq', 'test-groq', ?, ?, ?, 'healthy', 1)
      `).run(secret.encrypted, secret.iv, secret.authTag);

      const inserted = db.prepare(`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, context_window, enabled, supports_vision, supports_tools)
        VALUES ('groq', 'llama-3.3-70b', 'Llama 3.3 70B', 5, 2, 'Large', 128000, 1, 0, 1)
      `).run();
      const id = Number(inserted.lastInsertRowid);
      db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 1, 1)').run(id);
    });

    it('selectAutoCandidate picks an eligible model candidate for "auto/coding:fast"', () => {
      const ctx = buildRoutingContext({
        estimatedInputTokens: 100,
        estimatedOutputTokens: 500,
        hasTools: true,
        hasVision: false,
        modelString: 'auto/coding:fast',
      });
      const res = selectAutoCandidate('auto/coding:fast', ctx);
      expect(res).not.toHaveProperty('error');
      if ('candidate' in res) {
        expect(res.candidate.provider).toBe('groq');
        expect(res.candidate.model).toBe('llama-3.3-70b');
      }
    });

    it('returns HTTP 402 status when strict budget is violated', () => {
      const ctx = buildRoutingContext({
        estimatedInputTokens: 100,
        estimatedOutputTokens: 500,
        hasTools: false,
        hasVision: false,
        modelString: 'auto',
        budget: 0.000001, // impossibly tiny budget
        budgetFallback: 'strict',
      });
      const res: any = selectAutoCandidate('auto', ctx);
      expect(res.error).toContain('satisfies budget');
      expect(res.status).toBe(402);
    });

    it('returns 413 error when request exceeds max candidate context window', () => {
      const ctx = buildRoutingContext({
        estimatedInputTokens: 200000,
        estimatedOutputTokens: 10000,
        hasTools: false,
        hasVision: false,
        modelString: 'auto',
      });
      const res: any = selectAutoCandidate('auto', ctx);
      expect(res.status).toBe(413);
      expect(res.error).toContain('too large');
    });
  });

});
