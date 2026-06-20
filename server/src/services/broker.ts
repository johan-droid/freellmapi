import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { ChatMessage, ChatToolDefinition } from '@freellmapi/shared/types.js';
import { getDb } from '../db/index.js';
import { ensurePersistenceSchema } from '../db/persistence-schema.js';
import { contentToString, messageHasImage } from '../lib/content.js';
import type { RouteResult } from './router.js';

export type ClientProfileKey = 'claude-code' | 'opencode' | 'lisa' | 'generic';
export type WorkloadKind =
  | 'tool_agent'
  | 'code_agent'
  | 'code_review'
  | 'reasoning'
  | 'chat'
  | 'json'
  | 'long_context'
  | 'vision'
  | 'embedding';

export interface BrokerContext {
  requestId: string;
  sessionHash: string;
  clientProfile: ClientProfileKey;
  workload: WorkloadKind;
  routeReasons: string[];
  requestedAlias?: string;
  aliasTarget?: { providerSlug: string | null; modelId: string | null };
}

export interface BrokerRequestInput {
  endpoint: 'chat' | 'responses' | 'embeddings';
  token?: string;
  messages?: ChatMessage[];
  tools?: ChatToolDefinition[];
  requestedModel?: string;
  stream?: boolean;
  maxTokens?: number | null;
  hasJsonSignal?: boolean;
}

function idFor(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

function headerValue(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function messageText(messages: ChatMessage[] = []): string {
  return messages.map(m => `${m.role}:${contentToString(m.content)}`).join('\n');
}

function firstUserText(messages: ChatMessage[] = []): string {
  const msg = messages.find(m => m.role === 'user');
  return msg ? contentToString(msg.content) : messageText(messages).slice(0, 1000);
}

function isLikelyCode(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(diff|stack trace|traceback|typescript|javascript|python|tsx|jsx|json|schema|function|class|import|export|compile|lint|test failure|git|repo|file path)\b/.test(t)
    || /```/.test(text)
    || /(?:^|\s)(src|server|client|app|lib|routes|components)[\\/][\w./-]+/i.test(text);
}

function isLikelyReview(text: string): boolean {
  return /\b(review|audit|regression|bug risk|security issue|missing test|pull request|pr comments?)\b/i.test(text);
}

function isLikelyReasoning(text: string): boolean {
  return /\b(reason|think|plan|prove|derive|analyze|architecture|tradeoff|debug)\b/i.test(text);
}

export function detectClientProfile(req: Request, input: BrokerRequestInput): ClientProfileKey {
  const explicit = (headerValue(req, 'x-freellmapi-client') || headerValue(req, 'x-client-name')).toLowerCase();
  const userAgent = headerValue(req, 'user-agent').toLowerCase();
  const bodyText = messageText(input.messages).toLowerCase();

  if (explicit.includes('lisa')) return 'lisa';
  if (explicit.includes('claude')) return 'claude-code';
  if (explicit.includes('opencode') || explicit.includes('open-code')) return 'opencode';

  if (userAgent.includes('claude') || userAgent.includes('anthropic')) return 'claude-code';
  if (userAgent.includes('opencode') || userAgent.includes('open-code')) return 'opencode';
  if (userAgent.includes('lisa')) return 'lisa';

  if (input.endpoint === 'responses' && (input.tools?.length ?? 0) > 0) return 'claude-code';
  if (bodyText.includes('claude_code') || bodyText.includes('claude code')) return 'claude-code';
  if (bodyText.includes('opencode') || bodyText.includes('open code')) return 'opencode';
  if (bodyText.includes('lisa')) return 'lisa';

  return 'generic';
}

export function classifyWorkload(input: BrokerRequestInput): { workload: WorkloadKind; reasons: string[] } {
  const messages = input.messages ?? [];
  const text = messageText(messages);
  const estimatedInputTokens = Math.ceil(text.length / 4);
  const reasons: string[] = [];

  if (input.endpoint === 'embeddings') return { workload: 'embedding', reasons: ['embedding_endpoint'] };
  if (messageHasImage(messages)) {
    reasons.push('vision_content');
    return { workload: 'vision', reasons };
  }
  if (input.hasJsonSignal || /\bjson\b|\bschema\b|structured output/i.test(text)) {
    reasons.push('json_signal');
    return { workload: 'json', reasons };
  }
  if ((input.tools?.length ?? 0) > 0) {
    reasons.push('tools_present');
    return { workload: isLikelyCode(text) ? 'code_agent' : 'tool_agent', reasons };
  }
  if (estimatedInputTokens + (input.maxTokens ?? 0) > 48_000) {
    reasons.push('long_context');
    return { workload: 'long_context', reasons };
  }
  if (isLikelyReview(text)) {
    reasons.push('review_language');
    return { workload: 'code_review', reasons };
  }
  if (isLikelyCode(text)) {
    reasons.push('code_language');
    return { workload: 'code_agent', reasons };
  }
  if (isLikelyReasoning(text)) {
    reasons.push('reasoning_language');
    return { workload: 'reasoning', reasons };
  }

  return { workload: 'chat', reasons: ['default_chat'] };
}

export function resolveModelAlias(requestedModel?: string): { modelId?: string; providerSlug?: string | null; alias?: string } {
  if (!requestedModel || requestedModel === 'auto') return { modelId: requestedModel };
  ensurePersistenceSchema(getDb());
  const row = getDb().prepare(`
    SELECT alias, resolved_provider_slug, resolved_model_id
    FROM model_aliases
    WHERE alias = ?
  `).get(requestedModel) as { alias: string; resolved_provider_slug: string | null; resolved_model_id: string | null } | undefined;
  if (!row?.resolved_model_id) return { modelId: requestedModel };
  return { modelId: row.resolved_model_id, providerSlug: row.resolved_provider_slug, alias: row.alias };
}

function sessionHashFor(input: BrokerRequestInput): string {
  const stablePrompt = firstUserText(input.messages);
  const tokenPart = input.token ? idFor('token', input.token).slice(0, 24) : 'anonymous';
  return idFor(input.endpoint, tokenPart, stablePrompt.slice(0, 4000));
}

export function buildBrokerContext(req: Request, input: BrokerRequestInput): BrokerContext {
  ensurePersistenceSchema(getDb());
  const clientProfile = detectClientProfile(req, input);
  const classified = classifyWorkload(input);
  const alias = resolveModelAlias(input.requestedModel);
  const routeReasons = [...classified.reasons];
  if (alias.alias) routeReasons.push(`alias:${alias.alias}`);

  const context: BrokerContext = {
    requestId: crypto.randomUUID(),
    sessionHash: sessionHashFor(input),
    clientProfile,
    workload: classified.workload,
    routeReasons,
    ...(alias.alias ? { requestedAlias: alias.alias, aliasTarget: { providerSlug: alias.providerSlug ?? null, modelId: alias.modelId ?? null } } : {}),
  };

  upsertRequestSession(context);
  return context;
}

export function upsertRequestSession(ctx: BrokerContext): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO request_sessions (
      id, session_hash, client_profile, workload, first_seen_at, last_seen_at, request_count, metadata_json
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1, ?)
    ON CONFLICT(session_hash) DO UPDATE SET
      client_profile = excluded.client_profile,
      workload = excluded.workload,
      last_seen_at = datetime('now'),
      request_count = request_count + 1,
      metadata_json = excluded.metadata_json
  `).run(
    idFor('session', ctx.sessionHash),
    ctx.sessionHash,
    ctx.clientProfile,
    ctx.workload,
    JSON.stringify({ routeReasons: ctx.routeReasons, requestedAlias: ctx.requestedAlias ?? null }),
  );
}

export function getStickyModelFromSession(ctx: BrokerContext, requireVision = false, requireTools = false): number | undefined {
  const row = getDb().prepare(`
    SELECT m.id
    FROM request_sessions s
    JOIN models m ON m.platform = s.sticky_model_provider AND m.model_id = s.sticky_model_id
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE s.session_hash = ?
      AND s.last_seen_at >= datetime('now', '-12 hours')
      AND m.enabled = 1
      AND fc.enabled = 1
      AND (? = 0 OR m.supports_vision = 1)
      AND (? = 0 OR m.supports_tools = 1)
  `).get(ctx.sessionHash, requireVision ? 1 : 0, requireTools ? 1 : 0) as { id: number } | undefined;
  return row?.id;
}

export function rememberSessionRoute(ctx: BrokerContext, route: RouteResult): void {
  getDb().prepare(`
    UPDATE request_sessions
    SET sticky_model_provider = ?, sticky_model_id = ?, last_seen_at = datetime('now')
    WHERE session_hash = ?
  `).run(route.platform, route.modelId, ctx.sessionHash);
}

export function logRouteDecision(
  ctx: BrokerContext,
  route: RouteResult | null,
  opts: {
    status: 'success' | 'error';
    fallbackAttempts?: number;
    reason?: string;
    candidates?: Array<{ platform: string; modelId: string; score?: number }>;
    racedModels?: Array<{ platform: string; modelId: string }>;
  },
): void {
  try {
    ensurePersistenceSchema(getDb());
    getDb().prepare(`
      INSERT INTO route_decisions (
        id, request_id, session_hash, client_profile, workload, selected_provider_slug,
        selected_model_id, candidate_models_json, route_reason_json, fallback_attempts,
        raced_models_json, winner_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      ctx.requestId,
      ctx.sessionHash,
      ctx.clientProfile,
      ctx.workload,
      route?.platform ?? null,
      route?.modelId ?? null,
      JSON.stringify(opts.candidates ?? []),
      JSON.stringify({ status: opts.status, reasons: ctx.routeReasons, note: opts.reason ?? null }),
      opts.fallbackAttempts ?? 0,
      JSON.stringify(opts.racedModels ?? []),
      opts.reason ?? null,
    );
  } catch (error) {
    console.error('[broker] Failed to log route decision:', error);
  }
}

export function applyBrokerHeaders(res: Response, ctx: BrokerContext, route?: RouteResult, fallbackAttempts?: number): void {
  res.setHeader('X-FreeLLMAPI-Request-Id', ctx.requestId);
  res.setHeader('X-FreeLLMAPI-Client', ctx.clientProfile);
  res.setHeader('X-FreeLLMAPI-Workload', ctx.workload);
  if (ctx.routeReasons.length > 0) res.setHeader('X-FreeLLMAPI-Route-Reason', ctx.routeReasons.join(','));
  if (ctx.requestedAlias) res.setHeader('X-FreeLLMAPI-Alias', ctx.requestedAlias);
  if (route) res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
  if (fallbackAttempts && fallbackAttempts > 0) res.setHeader('X-Fallback-Attempts', String(fallbackAttempts));
}

export function isDiscontinuedModelError(error: unknown): boolean {
  const msg = String((error as { message?: unknown })?.message ?? error ?? '').toLowerCase();
  return msg.includes('model_not_found')
    || msg.includes('unavailable_model')
    || msg.includes('no endpoints found')
    || msg.includes('model deprecated')
    || msg.includes('model has been deprecated')
    || msg.includes('model discontinued')
    || msg.includes('model retired')
    || msg.includes('api error 410')
    || msg.includes(' 410 ')
    || msg.includes('api error 404')
    || msg.includes(' 404 ');
}

export function markModelUnavailableFromError(platform: string, modelId: string, error: unknown): void {
  if (!isDiscontinuedModelError(error)) return;
  try {
    ensurePersistenceSchema(getDb());
    const db = getDb();
    const message = String((error as { message?: unknown })?.message ?? error ?? 'model unavailable');
    const before = db.prepare(`
      SELECT status FROM provider_catalog_models WHERE provider_slug = ? AND provider_model_id = ?
    `).get(platform, modelId) as { status: string } | undefined;

    db.prepare(`
      UPDATE provider_catalog_models
      SET status = 'removed', removed_at = COALESCE(removed_at, datetime('now')), updated_at = datetime('now')
      WHERE provider_slug = ? AND provider_model_id = ?
    `).run(platform, modelId);

    db.prepare(`
      UPDATE models SET enabled = 0
      WHERE platform = ? AND model_id = ?
    `).run(platform, modelId);

    db.prepare(`
      INSERT INTO model_change_events (id, provider_slug, provider_model_id, change_type, old_value_json, new_value_json)
      VALUES (?, ?, ?, 'auto_disabled', ?, ?)
    `).run(
      crypto.randomUUID(),
      platform,
      modelId,
      JSON.stringify({ status: before?.status ?? null }),
      JSON.stringify({ status: 'removed', reason: message.slice(0, 500) }),
    );
  } catch (e) {
    console.error('[broker] Failed to mark model unavailable:', e);
  }
}
