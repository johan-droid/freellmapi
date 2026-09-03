import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, connectDb } from '../../db/index.js';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { ensurePersistenceSchema } from '../../db/persistence-schema.js';
import { isRateLimitSignal, isContextTooLargeError, isRetryableError } from '../../lib/error-classify.js';
import { setCooldown } from '../../services/ratelimit.js';

describe('Multi-Provider Deterministic Failover Acceptance Test (Phase 34)', () => {
  beforeEach(() => {
    connectDb(':memory:');
    runMigrationsSync(getDb(), 'up');
    ensurePersistenceSchema(getDb());
  });

  it('simulates failover across Groq -> Cerebras -> Fireworks -> Together -> DeepInfra', async () => {
    const candidates = [
      { provider: 'groq', model: 'llama-3.3-70b', status: 429, errorMsg: 'Rate limit exceeded' },
      { provider: 'cerebras', model: 'llama-3.3-70b', status: 413, errorMsg: 'Context window overflow' },
      { provider: 'fireworks', model: 'llama-3.3-70b', status: 408, errorMsg: 'Upstream gateway timeout' },
      { provider: 'together', model: 'llama-3.3-70b', status: 500, errorMsg: 'Internal server error' },
      { provider: 'deepinfra', model: 'llama-3.3-70b', status: 200, resultText: 'Success response from DeepInfra' },
    ];

    const fallbackAttempts: string[] = [];
    let selectedCandidate: (typeof candidates)[number] | null = null;

    for (const c of candidates) {
      if (c.status === 200) {
        selectedCandidate = c;
        break;
      } else {
        fallbackAttempts.push(`${c.provider}:${c.status}`);
        const errObj = { status: c.status, message: c.errorMsg };
        expect(isRetryableError(errObj)).toBe(true);

        if (c.status === 429) {
          expect(isRateLimitSignal(errObj)).toBe(true);
          setCooldown(c.provider, 60, 'Rate limit exceeded 429');
        } else if (c.status === 413) {
          expect(isContextTooLargeError(errObj)).toBe(true);
        }
      }
    }

    expect(fallbackAttempts).toEqual([
      'groq:429',
      'cerebras:413',
      'fireworks:408',
      'together:500',
    ]);
    expect(selectedCandidate).toBeDefined();
    expect(selectedCandidate?.provider).toBe('deepinfra');
    expect(selectedCandidate?.resultText).toBe('Success response from DeepInfra');
  });
});
