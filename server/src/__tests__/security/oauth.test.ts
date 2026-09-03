import { describe, it, expect } from 'vitest';
import { generateOAuthState, validateAndConsumeOAuthState, buildDynamicOAuthCallbackUrl } from '../../security/oauth.js';

describe('OAuth Infrastructure Security & State Management', () => {
  it('generates cryptographically random single-use state tokens', () => {
    const state1 = generateOAuthState('github');
    const state2 = generateOAuthState('github');

    expect(state1).toHaveLength(64);
    expect(state2).toHaveLength(64);
    expect(state1).not.toBe(state2);
  });

  it('validates state tokens and enforces single-use consumption', () => {
    const state = generateOAuthState('github');

    // First validation succeeds
    const firstAttempt = validateAndConsumeOAuthState(state, 'github');
    expect(firstAttempt).toBe(true);

    // Second validation fails because state is single-use and already consumed
    const secondAttempt = validateAndConsumeOAuthState(state, 'github');
    expect(secondAttempt).toBe(false);
  });

  it('rejects state validation on provider mismatch', () => {
    const state = generateOAuthState('github');

    // Validation with wrong provider fails
    const mismatchAttempt = validateAndConsumeOAuthState(state, 'google_vertex');
    expect(mismatchAttempt).toBe(false);
  });

  it('builds dynamic callback URLs correctly', () => {
    const devUrl = buildDynamicOAuthCallbackUrl('github', 'localhost:3001', 'http');
    expect(devUrl).toBe('http://localhost:3001/api/auth/github/callback');

    const prodUrl = buildDynamicOAuthCallbackUrl('github', 'api.freellmapi.com', 'https');
    expect(prodUrl).toBe('https://api.freellmapi.com/api/auth/github/callback');
  });
});
