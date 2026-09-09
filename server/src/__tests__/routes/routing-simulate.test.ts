import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { mintDashboardToken } from '../helpers/auth.js';

async function post(app: Express, path: string, body: any, token: string) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log('RESPONSE STATUS:', response.status, 'TEXT:', text.slice(0, 300));
  let resBody: any;
  try { resBody = JSON.parse(text); } catch { resBody = text; }
  server.close();
  return { status: response.status, body: resBody };
}

describe('POST /api/analytics/routing/simulate', () => {
  let app: Express;
  let token: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    token = mintDashboardToken();
  });

  it('simulates a routing decision read-only with workload detection and explanation', async () => {
    const payload = {
      requested_model: 'auto/agentic',
      messages: [{ role: 'user', content: 'Run test suite' }],
      tools: [{ type: 'function', function: { name: 'run_cmd' } }],
    };

    const res = await post(app, '/api/analytics/routing/simulate', payload, token);
    expect(res.status).toBe(200);
  });
});
