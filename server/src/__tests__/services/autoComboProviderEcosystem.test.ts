import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, connectDb } from '../../db/index.js';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { ensurePersistenceSchema } from '../../db/persistence-schema.js';
import { selectAutoCandidate, buildRoutingContext } from '../../services/autoCombo/engine.js';
import { filterCandidates } from '../../services/autoCombo/candidateFilter.js';
import type { AutoCandidate } from '../../services/autoCombo/types.js';

describe('Auto-Combo Engine — Multi-Provider Ecosystem & Policy Tests', () => {
  beforeEach(() => {
    connectDb(':memory:');
    runMigrationsSync(getDb(), 'up');
    ensurePersistenceSchema(getDb());
  });

  it('filters auto/offline to prefer local providers', () => {
    const mockCandidates: Partial<AutoCandidate>[] = [
      { provider: 'groq', model: 'llama-3.3-70b', displayName: 'Groq Llama', costPer1MTokens: 0.1, quotaScore: 0.9, circuitBreakerState: 'CLOSED', chainRow: { key_id: 1 } as any },
      { provider: 'ollama_local', model: 'llama3:latest', displayName: 'Local Llama', costPer1MTokens: 0, quotaScore: 1, circuitBreakerState: 'CLOSED', chainRow: { key_id: 2 } as any },
      { provider: 'lmstudio', model: 'qwen2.5-coder', displayName: 'LM Studio Qwen', costPer1MTokens: 0, quotaScore: 1, circuitBreakerState: 'CLOSED', chainRow: { key_id: 3 } as any },
    ];

    const ctx = buildRoutingContext({
      estimatedInputTokens: 500,
      estimatedOutputTokens: 200,
      hasTools: false,
      hasVision: false,
      modelString: 'auto/offline',
    });

    const parsed = { isValid: true, variant: 'offline' };
    const filtered = filterCandidates(mockCandidates as AutoCandidate[], parsed as any, ctx);

    expect(filtered.length).toBe(2);
    expect(filtered.every(c => c.provider === 'ollama_local' || c.provider === 'lmstudio')).toBe(true);
  });

  it('respects China provider exclusion policy during candidate generation', () => {
    const db = getDb();
    db.prepare("INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status) VALUES ('zhipu', 'Zhipu Key', 'e', 'i', 'a', 'healthy')").run();
    db.prepare("INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status) VALUES ('groq', 'Groq Key', 'e', 'i', 'a', 'healthy')").run();

    db.prepare("INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled) VALUES ('zhipu', 'glm-4.7', 'GLM 4.7', 5, 5, 1)").run();
    db.prepare("INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled) VALUES ('groq', 'llama-3.3-70b', 'Groq Llama 3.3', 5, 5, 1)").run();

    const ctx = buildRoutingContext({
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
      hasTools: false,
      hasVision: false,
      modelString: 'auto/fast',
    });

    const result = selectAutoCandidate('auto/fast', ctx);
    if ('candidate' in result) {
      expect(result.candidate.provider).not.toBe('zhipu');
      expect(result.candidate.provider).toBe('groq');
    }
  });
});
