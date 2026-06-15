import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { runModelDiscoveryOnce } from '../../jobs/modelDiscoveryJob.js';
import * as catalog from '../../providers/catalog/index.js';

describe('model discovery union handling', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare("DELETE FROM provider_catalog_models WHERE provider_slug = 'catalog-test'").run();

    const first = encrypt('acct-one');
    const second = encrypt('acct-two');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES ('catalog-test', 'one', ?, ?, ?, 'unknown', 1),
             ('catalog-test', 'two', ?, ?, ?, 'unknown', 1)
    `).run(first.encrypted, first.iv, first.authTag, second.encrypted, second.iv, second.authTag);

    db.prepare(`
      INSERT INTO provider_catalog_models (
        id, provider_slug, provider_model_id, display_name, status, discovered_at, last_seen_at, updated_at
      ) VALUES
        ('legacy-a', 'catalog-test', 'model-a', 'Model A', 'active', datetime('now'), datetime('now'), datetime('now')),
        ('legacy-b', 'catalog-test', 'model-b', 'Model B', 'active', datetime('now'), datetime('now'), datetime('now'))
    `).run();
  });

  it('keeps the provider active set as the union of successful account discoveries', async () => {
    const spy = vi.spyOn(catalog, 'discoverProviderModels');
    spy.mockResolvedValueOnce([
      { provider_slug: 'catalog-test', provider_model_id: 'model-a', display_name: 'Model A' } as any,
    ]);
    spy.mockResolvedValueOnce([
      { provider_slug: 'catalog-test', provider_model_id: 'model-b', display_name: 'Model B' } as any,
    ]);

    await runModelDiscoveryOnce();

    const db = getDb();
    const rows = db.prepare(`
      SELECT provider_model_id, status
      FROM provider_catalog_models
      WHERE provider_slug = 'catalog-test'
      ORDER BY provider_model_id
    `).all() as Array<{ provider_model_id: string; status: string }>;

    expect(rows).toEqual([
      { provider_model_id: 'model-a', status: 'active' },
      { provider_model_id: 'model-b', status: 'active' },
    ]);
  });
});
