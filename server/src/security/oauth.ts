import crypto from 'crypto';

interface OAuthStateRecord {
  state: string;
  provider: string;
  sessionHash?: string;
  createdAt: number;
  expiresAt: number;
}

const OAUTH_STATES = new Map<string, OAuthStateRecord>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generates a cryptographically random, single-use, short-lived OAuth state.
 */
export function generateOAuthState(provider: string, sessionHash?: string): string {
  const state = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  OAUTH_STATES.set(state, {
    state,
    provider,
    sessionHash,
    createdAt: now,
    expiresAt: now + STATE_TTL_MS,
  });
  return state;
}

/**
 * Validates and consumes an OAuth state token.
 * Single-use: state is immediately deleted upon validation.
 */
export function validateAndConsumeOAuthState(state: string, expectedProvider: string): boolean {
  if (!state || typeof state !== 'string') return false;
  const record = OAUTH_STATES.get(state);
  if (!record) return false;

  // Single-use: delete immediately
  OAUTH_STATES.delete(state);

  const now = Date.now();
  if (now > record.expiresAt) {
    return false; // Expired
  }

  if (record.provider !== expectedProvider) {
    return false; // Provider mismatch
  }

  return true;
}

/**
 * Builds dynamic callback URL using environment PUBLIC_BASE_URL or req headers.
 */
export function buildDynamicOAuthCallbackUrl(provider: string, hostHeader?: string, protocol = 'http'): string {
  const baseUrl = process.env.PUBLIC_BASE_URL
    || (hostHeader ? `${protocol}://${hostHeader}` : 'http://localhost:3001');
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/api/auth/${provider}/callback`;
}
