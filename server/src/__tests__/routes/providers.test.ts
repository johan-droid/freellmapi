import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: any) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(isGatedApiPath(path) ? { Authorization: `Bearer ${dashToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('provider account mirroring', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM provider_accounts').run();
    db.prepare("DELETE FROM api_keys WHERE platform = 'groq'").run();
  });

  it('creates a live api key mirror when a provider account is added', async () => {
    const res = await request(app, 'POST', '/api/provider-accounts', {
      providerSlug: 'groq',
      displayName: 'Groq Primary',
      accountEmail: 'ops@example.com',
      apiKey: 'gsk_test_provider_account',
    });

    expect(res.status).toBe(201);
    const db = getDb();
    const account = db.prepare(`
      SELECT provider_slug, display_name, linked_api_key_id
      FROM provider_accounts
      WHERE provider_slug = 'groq'
    `).get() as any;
    expect(account.linked_api_key_id).toBeTruthy();

    const key = db.prepare('SELECT id, platform, label, enabled FROM api_keys WHERE id = ?').get(account.linked_api_key_id) as any;
    expect(key).toMatchObject({
      id: account.linked_api_key_id,
      platform: 'groq',
      label: 'Groq Primary',
      enabled: 1,
    });
  });

  it('keeps the mirrored api key in sync on patch and delete', async () => {
    const created = await request(app, 'POST', '/api/provider-accounts', {
      providerSlug: 'groq',
      displayName: 'Groq Primary',
      accountEmail: 'ops@example.com',
      apiKey: 'gsk_test_provider_account',
    });
    expect(created.status).toBe(201);

    const db = getDb();
    const account = db.prepare('SELECT id, linked_api_key_id FROM provider_accounts').get() as { id: string; linked_api_key_id: number };

    const patched = await request(app, 'PATCH', `/api/provider-accounts/${account.id}`, {
      displayName: 'Groq Standby',
      status: 'disabled',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    expect(patched.status).toBe(200);

    const key = db.prepare('SELECT label, enabled, base_url FROM api_keys WHERE id = ?').get(account.linked_api_key_id) as any;
    expect(key).toMatchObject({
      label: 'Groq Standby',
      enabled: 0,
      base_url: 'https://api.groq.com/openai/v1',
    });

    const deleted = await request(app, 'DELETE', `/api/provider-accounts/${account.id}`);
    expect(deleted.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE id = ?').get(account.linked_api_key_id) as { n: number }).toMatchObject({ n: 0 });
  });
});
