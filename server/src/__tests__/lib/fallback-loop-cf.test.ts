import { describe, it, expect } from 'vitest';
import { isKeyAuthError } from '../../lib/error-classify.js';

describe('Cloudflare 401 Auth Error Handling', () => {
  it('should correctly identify Cloudflare 401 string errors as Key Auth Errors', () => {
    expect(isKeyAuthError({ message: 'Cloudflare API error 401: Unauthorized' })).toBe(true);
    expect(isKeyAuthError({ message: 'Cloudflare API error 401' })).toBe(true);
    expect(isKeyAuthError({ message: 'Some other error', status: 400 })).toBe(false);
  });
});
