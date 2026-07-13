import { describe, it, expect } from 'vitest';
import { exhaustedRetryError } from '../../lib/fallback-loop.js';

describe('exhaustedRetryError', () => {
  it('should include PROVIDER_COOLDOWN code and retry info', () => {
    // just test that it returns the new fields
    const res = exhaustedRetryError(new Error('test'), 1, { attempts: [], timedOut: false });
    expect(res.code).toBe('PROVIDER_COOLDOWN');
    expect(res.kind).toBe('rate_limit');
    expect(res.type).toBe('rate_limit_error');
    // retry_after_seconds and available_after might be undefined if getSoonestCooldownExpiry() is null, but we just check the structure.
    expect('retry_after_seconds' in res).toBe(true);
    expect('available_after' in res).toBe(true);
  });
});
