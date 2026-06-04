import { describe, it, expect, beforeAll } from 'vitest';
import { runModelDiscovery } from '../../services/modelDiscovery.js';
import { initDb } from '../../db/index.js';

describe('Model Discovery Service', () => {
  beforeAll(() => {
    initDb(':memory:');
  });

  it('should run model discovery without throwing errors', async () => {
    // Tests for the basic model discovery logic
    const summary = await runModelDiscovery();
    expect(summary).toBeDefined();
    expect(summary.providersChecked).toBeDefined();
    expect(summary.errors).toBeDefined();
  });
});
