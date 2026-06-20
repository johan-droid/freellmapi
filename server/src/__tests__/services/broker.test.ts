import { describe, expect, it, beforeEach } from 'vitest';
import type { Request } from 'express';
import { initDb, getDb } from '../../db/index.js';
import {
  buildBrokerContext,
  classifyWorkload,
  getStickyModelFromSession,
  markModelUnavailableFromError,
  rememberSessionRoute,
  resolveModelAlias,
} from '../../services/broker.js';

function req(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe('broker intelligence', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('detects explicit Lisa clients and code-agent workloads', () => {
    const ctx = buildBrokerContext(req({ 'x-freellmapi-client': 'lisa' }), {
      endpoint: 'chat',
      token: 'test',
      stream: true,
      messages: [{ role: 'user', content: 'Fix this TypeScript stack trace in server/src/app.ts' }],
      tools: [{ type: 'function', function: { name: 'edit_file' } }],
    });

    expect(ctx.clientProfile).toBe('lisa');
    expect(ctx.workload).toBe('code_agent');
    expect(ctx.routeReasons).toContain('tools_present');
  });

  it('classifies long-context requests before generic reasoning/chat', () => {
    const text = 'a'.repeat(210_000);
    const classified = classifyWorkload({
      endpoint: 'chat',
      messages: [{ role: 'user', content: text }],
      maxTokens: 4096,
    });

    expect(classified.workload).toBe('long_context');
    expect(classified.reasons).toContain('long_context');
  });

  it('resolves stable aliases to provider model ids', () => {
    getDb().prepare(`
      INSERT INTO model_aliases (id, alias, description, workload, resolved_provider_slug, resolved_model_id)
      VALUES ('alias_1', 'claude-code-default', 'Default agent model', 'tool_agent', 'google', 'gemini-2.5-flash')
    `).run();

    expect(resolveModelAlias('claude-code-default')).toEqual({
      alias: 'claude-code-default',
      providerSlug: 'google',
      modelId: 'gemini-2.5-flash',
    });
  });

  it('persists sticky session choices across broker lookups', () => {
    const ctx = buildBrokerContext(req(), {
      endpoint: 'chat',
      token: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const model = getDb().prepare(`
      SELECT id, platform, model_id FROM models WHERE enabled = 1 LIMIT 1
    `).get() as { id: number; platform: string; model_id: string };

    rememberSessionRoute(ctx, {
      provider: {} as any,
      modelId: model.model_id,
      modelDbId: model.id,
      apiKey: 'k',
      keyId: 1,
      platform: model.platform,
      displayName: model.model_id,
      rpdLimit: null,
      tpdLimit: null,
    });

    expect(getStickyModelFromSession(ctx)).toBe(model.id);
  });

  it('auto-disables discontinued models from strong provider errors', () => {
    const row = getDb().prepare(`
      SELECT platform, model_id FROM models WHERE enabled = 1 LIMIT 1
    `).get() as { platform: string; model_id: string };
    getDb().prepare(`
      INSERT INTO provider_catalog_models (id, provider_slug, provider_model_id, display_name, status)
      VALUES ('catalog_1', ?, ?, ?, 'active')
    `).run(row.platform, row.model_id, row.model_id);

    markModelUnavailableFromError(row.platform, row.model_id, new Error('API error 404: model_not_found'));

    const updated = getDb().prepare(`
      SELECT m.enabled, pcm.status
      FROM models m
      JOIN provider_catalog_models pcm ON pcm.provider_slug = m.platform AND pcm.provider_model_id = m.model_id
      WHERE m.platform = ? AND m.model_id = ?
    `).get(row.platform, row.model_id) as { enabled: number; status: string };
    expect(updated).toEqual({ enabled: 0, status: 'removed' });
  });
});
