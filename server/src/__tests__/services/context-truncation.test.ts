import { describe, it, expect } from 'vitest';
import { truncateMessagesToFit, estimateTokens } from '../../lib/context-truncation.js';

describe('truncateMessagesToFit', () => {
  it('should not truncate if messages fit', () => {
    const messages = [
      { role: 'system', content: 'test sys' },
      { role: 'user', content: 'test msg' }
    ] as any;
    const result = truncateMessagesToFit(messages, 1000, 100, 0, 100);
    expect(result.truncated).toBe(false);
    expect(result.messages.length).toBe(2);
  });

  it('should truncate non-protected messages when limit is exceeded', () => {
    const messages = [
      { role: 'system', content: 'system' }, // 6/4 = 2 tokens
      { role: 'user', content: 'hello' }, // 5/4 = 2 tokens -> not protected since it's not latest
      { role: 'assistant', content: 'hi' }, // 5/4 = 2 tokens -> not protected
      { role: 'user', content: 'latest' } // 6/4 = 2 tokens -> protected
    ] as any;
    // Input is ~8 tokens.
    // We want to force truncation of the middle ones.
    const result = truncateMessagesToFit(messages, 5, 1, 0, 0); // effectiveLimit=5, total allowed input=4
    expect(result.truncated).toBe(true);
    expect(result.messages.length).toBe(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toBe('latest');
  });

  it('should preserve tool calls at the end', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', tool_calls: [{}] },
      { role: 'tool', content: 'res' }
    ] as any;
    const result = truncateMessagesToFit(messages, 0, 0, 0, 0); // Force max truncation
    expect(result.messages.length).toBe(4); // All should be protected (system, user=latest, assistant=tool_calls, tool)
  });
});
