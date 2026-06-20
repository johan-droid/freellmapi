import { describe, it, expect } from 'vitest';
import { isAutoModel, overrideIntentFromModel } from '../../services/request-intent.js';

describe('Request Intent Overrides', () => {
  describe('isAutoModel', () => {
    it('should return true for auto model strings', () => {
      expect(isAutoModel('auto')).toBe(true);
      expect(isAutoModel('coding')).toBe(true);
      expect(isAutoModel('thinking')).toBe(true);
      expect(isAutoModel('reasoning')).toBe(true);
      expect(isAutoModel('agentic')).toBe(true);
      expect(isAutoModel('')).toBe(true);
      expect(isAutoModel(undefined)).toBe(true);
    });

    it('should return false for concrete model IDs', () => {
      expect(isAutoModel('gpt-4o')).toBe(false);
      expect(isAutoModel('claude-3-5-sonnet')).toBe(false);
      expect(isAutoModel('gemini-2.5-flash')).toBe(false);
    });
  });

  describe('overrideIntentFromModel', () => {
    const baseIntent = {
      kind: 'chat' as const,
      coding: false,
      agentic: false,
      research: false,
      chat: true,
    };

    it('should force coding intent for coding model string', () => {
      const result = overrideIntentFromModel(baseIntent, 'coding');
      expect(result.kind).toBe('coding');
      expect(result.coding).toBe(true);
      expect(result.agentic).toBe(false);
      expect(result.research).toBe(false);
    });

    it('should force research intent for thinking/reasoning model strings', () => {
      const result1 = overrideIntentFromModel(baseIntent, 'thinking');
      expect(result1.kind).toBe('research');
      expect(result1.research).toBe(true);
      expect(result1.coding).toBe(false);

      const result2 = overrideIntentFromModel(baseIntent, 'reasoning');
      expect(result2.kind).toBe('research');
      expect(result2.research).toBe(true);
      expect(result2.coding).toBe(false);
    });

    it('should force agentic intent for agentic model string', () => {
      const result = overrideIntentFromModel(baseIntent, 'agentic');
      expect(result.kind).toBe('agentic');
      expect(result.agentic).toBe(true);
      expect(result.coding).toBe(true);
      expect(result.research).toBe(false);
    });

    it('should return original intent if model is not a specific auto override', () => {
      const result = overrideIntentFromModel(baseIntent, 'gpt-4o');
      expect(result).toEqual(baseIntent);
    });
  });
});
