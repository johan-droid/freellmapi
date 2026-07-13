import { describe, it, expect } from 'vitest';
import { getNextCooldownDuration } from '../../services/ratelimit.js';

describe('getNextCooldownDuration', () => {
  it('should calculate exponential backoff with jitter', () => {
    // Call multiple times and verify that the results generally grow
    const durations = [];
    for(let i=0; i<6; i++) {
       durations.push(getNextCooldownDuration('test', 'model', 1));
    }

    // Check that it's bounded and within the math
    for(let i=0; i<6; i++) {
        const baseDelay = 2000;
        const attempt = i;
        const maxExpected = Math.min(baseDelay * Math.pow(2, attempt), 60000) * 1.2;
        const minExpected = Math.min(baseDelay * Math.pow(2, attempt), 60000) * 0.8;

        expect(durations[i]).toBeGreaterThanOrEqual(Math.floor(minExpected));
        expect(durations[i]).toBeLessThanOrEqual(Math.floor(maxExpected));
    }
  });
});
