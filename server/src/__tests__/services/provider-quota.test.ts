import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { inferQuotaPoolKey, recordQuotaObservationsFromResponse, getQuotaStateForKeys } from '../../services/provider-quota.js';

describe('provider quota observability', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('groups shared free pools and persists rate-limit reset hints', () => {
    expect(inferQuotaPoolKey('openrouter', 'qwen/qwen3-coder:free')).toBe('openrouter::free');
    expect(inferQuotaPoolKey('groq', 'llama-3.3-70b-versatile')).toBe('groq::account');

    const response = new Response('', {
      status: 429,
      headers: new Headers({
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '60',
        'retry-after': '60',
      }),
    });

    const observations = recordQuotaObservationsFromResponse(response, {
      platform: 'groq',
      keyId: 1,
      modelId: 'llama-3.3-70b-versatile',
      endpoint: 'chat/completions',
    });

    expect(observations.length).toBeGreaterThan(0);

    const state = getDb().prepare(`
      SELECT platform, key_id, quota_pool_key, metric, limit_value, remaining_value, reset_strategy, source
      FROM provider_quota_state
      WHERE platform = 'groq' AND key_id = 1
    `).all() as { platform: string; key_id: number; quota_pool_key: string; metric: string; limit_value: number | null; remaining_value: number | null; reset_strategy: string; source: string }[];

    expect(state).toEqual([
      {
        platform: 'groq',
        key_id: 1,
        quota_pool_key: 'groq::account',
        metric: 'requests',
        limit_value: 100,
        remaining_value: 0,
        reset_strategy: 'provider_reported',
        source: 'header',
      },
    ]);

    const signals = getQuotaStateForKeys();
    expect(signals.some(row => row.platform === 'groq' && row.keyId === 1)).toBe(true);
  });
});
