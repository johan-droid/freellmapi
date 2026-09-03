import { describe, it, expect } from 'vitest';
import {
  getAllProviderDefinitions,
  getProviderDefinition,
  defineProvider,
} from '../../providers/definitions/index.js';
import { getEligibleProviders, isProviderEligible } from '../../providers/policy.js';

describe('Canonical Provider Registry & Policy System', () => {
  it('validates provider definitions have unique IDs and valid URLs', () => {
    const definitions = getAllProviderDefinitions();
    expect(definitions.length).toBeGreaterThan(20);

    const ids = new Set<string>();
    const aliases = new Set<string>();

    for (const def of definitions) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);

      for (const alias of def.aliases) {
        expect(aliases.has(alias)).toBe(false);
        aliases.add(alias);
      }

      expect(def.website).toMatch(/^https?:\/\//);
      expect(def.region).toBeDefined();
      expect(def.jurisdiction).toBeDefined();
      expect(def.auth).toBeDefined();
      expect(def.endpoint).toBeDefined();
      expect(def.capabilities).toBeDefined();
    }
  });

  it('retrieves explicit definitions by ID or alias', () => {
    const groq = getProviderDefinition('groq');
    expect(groq).toBeDefined();
    expect(groq?.name).toBe('Groq');
    expect(groq?.auth.keyCreationUrl).toBe('https://console.groq.com/keys');

    const openai = getProviderDefinition('openai');
    expect(openai).toBeDefined();
    expect(openai?.name).toBe('OpenAI');

    const anthropic = getProviderDefinition('anthropic');
    expect(anthropic).toBeDefined();

    const ollamaLocal = getProviderDefinition('ollama_local');
    expect(ollamaLocal).toBeDefined();
    expect(ollamaLocal?.routing.networkDependency).toBe(false);
  });

  it('enforces China provider exclusion policy correctly', () => {
    // Default policy excludes china jurisdiction providers
    const nonChinaEligible = getEligibleProviders({ allowChina: false });
    const chinaSlugs = ['zhipu', 'modelscope'];

    for (const slug of chinaSlugs) {
      const existsInEligible = nonChinaEligible.some(p => p.id === slug);
      expect(existsInEligible).toBe(false);
    }

    // Explicit allowChina includes china jurisdiction providers
    const allEligible = getEligibleProviders({ allowChina: true });
    for (const slug of chinaSlugs) {
      const existsInEligible = allEligible.some(p => p.id === slug);
      expect(existsInEligible).toBe(true);
    }
  });

  it('filters local vs network providers cleanly', () => {
    const localProviders = getEligibleProviders({ localOnly: true });
    expect(localProviders.length).toBeGreaterThanOrEqual(4);
    for (const p of localProviders) {
      expect(p.routing.networkDependency).toBe(false);
    }

    const networkProviders = getEligibleProviders({ networkOnly: true });
    for (const p of networkProviders) {
      expect(p.routing.networkDependency).toBe(true);
    }
  });
});
