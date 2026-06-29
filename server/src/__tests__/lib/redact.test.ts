import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { installLogRedaction } from '../../lib/redact.js';

describe('Log Redaction', () => {
  let logSpy: any;
  let errorSpy: any;

  beforeAll(() => {
    logSpy = vi.spyOn(console, 'log');
    errorSpy = vi.spyOn(console, 'error');
    installLogRedaction();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('redacts unified keys, groq keys, and gemini keys', () => {
    console.log('Unified key is freellmapi-bdb899094c03ee93aae31b8b91d1c277a558823c0ed2e985');
    expect(logSpy).toHaveBeenCalledWith('Unified key is freellmapi-[REDACTED]');

    console.log('Groq key: gsk_123456789012');
    expect(logSpy).toHaveBeenCalledWith('Groq key: gsk-[REDACTED]');

    console.log('Gemini key: AIzaSyD12345678901234567');
    expect(logSpy).toHaveBeenCalledWith('Gemini key: AIza[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    console.log('Authorization: Bearer abcdefghijklmnopqrs');
    expect(logSpy).toHaveBeenCalledWith('Authorization: Bearer [REDACTED]');
  });

  it('redacts keys/tokens/secrets in json or query parameters', () => {
    console.log('?key=mysecretvalue');
    expect(logSpy).toHaveBeenCalledWith('?key=[REDACTED]');

    console.log('api_key: "supersecret"');
    expect(logSpy).toHaveBeenCalledWith('api_key=[REDACTED]"');
  });

  it('redacts keys from Error objects and stacks', () => {
    const err = new Error('Failure with ?key=mysecretvalue');
    console.error(err);
    expect(errorSpy).toHaveBeenCalled();
    const loggedError = errorSpy.mock.calls[0][0];
    expect(loggedError).toBeInstanceOf(Error);
    expect(loggedError.message).toBe('Failure with ?key=[REDACTED]');
  });
});
