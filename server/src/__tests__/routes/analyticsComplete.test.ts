import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { mintDashboardToken } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, path: string) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${dashToken}` },
  });
  const data = await res.json().catch(() => null);
  server.close();

  return { status: res.status, body: data };
}

function insertTestRequest(platform: string, modelId: string, status: string, inTokens: number, outTokens: number, latencyMs: number, errorMsg: string | null = null) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error, created_at, client_ip, client_user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), '127.0.0.1', 'Vitest')
  `).run(platform, modelId, status, inTokens, outTokens, latencyMs, errorMsg);

  // Also update request_hourly so readAggregateSince sees the test numbers
  const currentHour = new Date().toISOString().slice(0, 13).replace('T', ' ') + ':00:00';
  db.prepare(`
    INSERT INTO request_hourly (hour, total_requests, success_count, error_count, input_tokens, output_tokens)
    VALUES (?, 1, ?, ?, ?, ?)
    ON CONFLICT(hour) DO UPDATE SET
      total_requests = total_requests + 1,
      success_count = success_count + excluded.success_count,
      error_count = error_count + excluded.error_count,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens
  `).run(
    currentHour,
    status === 'success' ? 1 : 0,
    status === 'error' ? 1 : 0,
    inTokens,
    outTokens
  );

  return Number(info.lastInsertRowid);
}

describe('Analytics Pipeline & Quota Pools API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM requests').run();
    db.prepare('DELETE FROM request_attempts').run();
    db.prepare('DELETE FROM request_hourly').run();
    db.prepare('DELETE FROM provider_accounts').run();
  });

  it('summary endpoint returns complete canonical token and status metrics', async () => {
    const req1 = insertTestRequest('groq', 'llama-3.3-70b', 'success', 100, 50, 200);
    const req2 = insertTestRequest('cerebras', 'llama-3.3-70b', 'error', 50, 0, 150, 'Rate limit exceeded: 429 Too Many Requests');

    // Add attempt trace for req2
    getDb().prepare(`
      INSERT INTO request_attempts (request_id, ordinal, platform, model_id, key_ordinal, outcome, start_offset_ms, duration_ms, error_summary)
      VALUES (?, 1, 'groq', 'llama-3.3-70b', 1, 'error', 0, 100, '429 Rate limit')
    `).run(req2);
    getDb().prepare(`
      INSERT INTO request_attempts (request_id, ordinal, platform, model_id, key_ordinal, outcome, start_offset_ms, duration_ms, error_summary)
      VALUES (?, 2, 'cerebras', 'llama-3.3-70b', 2, 'error', 100, 50, '429 Rate limit')
    `).run(req2);

    const { status, body } = await request(app, '/api/analytics/summary?range=24h');
    expect(status).toBe(200);
    expect(body.totalRequests).toBe(2);
    expect(body.totalTokens).toBe(200); // 100+50 + 50+0
    expect(body.totalInputTokens).toBe(150);
    expect(body.totalOutputTokens).toBe(50);
    expect(body.successRate).toBe(50);
    expect(body.errorRate).toBe(50);
    expect(body.rate429Count).toBe(1);
    expect(body.rate429Rate).toBe(50);
    expect(body.fallbackCount).toBe(1);
    expect(body.fallbackRate).toBe(50);
    expect(body.activeProvidersCount).toBe(2);
  });

  it('supports expanded time range options (5m, 15m, 1h, 6h, 24h, 7d, 30d, 90d)', async () => {
    insertTestRequest('groq', 'llama-3.3-70b', 'success', 10, 20, 100);

    for (const rangeOpt of ['5m', '15m', '1h', '6h', '24h', '7d', '30d', '90d']) {
      const { status, body } = await request(app, `/api/analytics/summary?range=${rangeOpt}`);
      expect(status).toBe(200);
      expect(body.totalRequests).toBeGreaterThanOrEqual(1);
    }
  });

  it('quota pools endpoint returns provider accounts and pool token usage', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO provider_accounts (id, provider_slug, display_name, encrypted_api_key, key_iv, key_auth_tag, status)
      VALUES ('acc_groq_1', 'groq', 'Groq Primary Key', 'enc', 'iv', 'tag', 'active')
    `).run();

    const { status, body } = await request(app, '/api/analytics/quota-pools');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0]).toMatchObject({
      accountId: 'acc_groq_1',
      providerSlug: 'groq',
      accountName: 'Groq Primary Key',
      status: 'active',
      quotaPoolKey: 'groq:acc_groq_1',
    });
  });

  it('request detail endpoint provides failover attempt trace', async () => {
    const reqId = insertTestRequest('cerebras', 'llama-3.3-70b', 'success', 80, 40, 250);

    getDb().prepare(`
      INSERT INTO request_attempts (request_id, ordinal, platform, model_id, key_ordinal, outcome, start_offset_ms, duration_ms, error_summary)
      VALUES (?, 1, 'groq', 'llama-3.3-70b', 1, 'error', 0, 120, '429 Rate limit')
    `).run(reqId);
    getDb().prepare(`
      INSERT INTO request_attempts (request_id, ordinal, platform, model_id, key_ordinal, outcome, start_offset_ms, duration_ms, error_summary)
      VALUES (?, 2, 'cerebras', 'llama-3.3-70b', 2, 'success', 120, 130, NULL)
    `).run(reqId);

    const { status, body } = await request(app, `/api/analytics/requests/${reqId}`);
    expect(status).toBe(200);
    expect(body.id).toBe(reqId);
    expect(body.platform).toBe('cerebras');
    expect(body.attempts).toHaveLength(2);
    expect(body.attempts[0].platform).toBe('groq');
    expect(body.attempts[0].outcome).toBe('error');
    expect(body.attempts[1].platform).toBe('cerebras');
    expect(body.attempts[1].outcome).toBe('success');
  });
});
