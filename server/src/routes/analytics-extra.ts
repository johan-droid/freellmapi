import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { ensurePersistenceSchema } from '../db/persistence-schema.js';

export const analyticsExtraRouter = Router();

function ensureSchema() {
  ensurePersistenceSchema(getDb());
}

analyticsExtraRouter.get('/providers', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT
      COALESCE(d.provider_slug, l.provider_slug) AS provider_slug,
      COALESCE(SUM(d.request_count), 0) AS requests,
      COALESCE(SUM(d.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(d.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(d.total_tokens), 0) AS total_tokens,
      COALESCE(SUM(d.failed_requests), 0) AS failed_requests,
      COALESCE(SUM(d.rate_limited_requests), 0) AS rate_limited_requests,
      MAX(l.rpm_limit) AS rpm_limit,
      MAX(l.rpd_limit) AS rpd_limit,
      MAX(l.tpm_limit) AS tpm_limit,
      MAX(l.tpd_limit) AS tpd_limit
    FROM provider_usage_daily d
    FULL OUTER JOIN provider_model_limits l ON l.provider_slug = d.provider_slug AND l.provider_model_id = d.provider_model_id
    GROUP BY COALESCE(d.provider_slug, l.provider_slug)
    ORDER BY total_tokens DESC
  `).all() as any[];

  res.json(rows.map(row => ({
    providerSlug: row.provider_slug,
    requests: row.requests ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    failedRequests: row.failed_requests ?? 0,
    rateLimitedRequests: row.rate_limited_requests ?? 0,
    rpmLimit: row.rpm_limit,
    rpdLimit: row.rpd_limit,
    tpmLimit: row.tpm_limit,
    tpdLimit: row.tpd_limit,
  })));
});

analyticsExtraRouter.get('/models', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT
      pcm.provider_slug,
      pcm.provider_model_id,
      pcm.display_name,
      pcm.status,
      COALESCE(SUM(d.request_count), 0) AS requests,
      COALESCE(SUM(d.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(d.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(d.total_tokens), 0) AS total_tokens,
      COALESCE(SUM(d.failed_requests), 0) AS failed_requests,
      pml.rpm_limit,
      pml.rpd_limit,
      pml.tpm_limit,
      pml.tpd_limit
    FROM provider_catalog_models pcm
    LEFT JOIN provider_usage_daily d
      ON d.provider_slug = pcm.provider_slug AND d.provider_model_id = pcm.provider_model_id
    LEFT JOIN provider_model_limits pml
      ON pml.provider_slug = pcm.provider_slug AND pml.provider_model_id = pcm.provider_model_id
    GROUP BY pcm.provider_slug, pcm.provider_model_id
    ORDER BY total_tokens DESC, pcm.provider_slug ASC, pcm.display_name ASC
  `).all() as any[];

  res.json(rows.map(row => ({
    providerSlug: row.provider_slug,
    modelId: row.provider_model_id,
    displayName: row.display_name ?? row.provider_model_id,
    status: row.status,
    requests: row.requests ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    failedRequests: row.failed_requests ?? 0,
    rpmLimit: row.rpm_limit,
    rpdLimit: row.rpd_limit,
    tpmLimit: row.tpm_limit,
    tpdLimit: row.tpd_limit,
  })));
});

analyticsExtraRouter.get('/usage/daily', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT * FROM provider_usage_daily
    ORDER BY usage_date DESC, total_tokens DESC
    LIMIT 500
  `).all() as any[];
  res.json(rows.map(row => ({
    id: row.id,
    providerSlug: row.provider_slug,
    providerAccountId: row.provider_account_id,
    modelId: row.provider_model_id,
    usageDate: row.usage_date,
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    failedRequests: row.failed_requests,
    rateLimitedRequests: row.rate_limited_requests,
    estimatedTpm: row.estimated_tpm,
    estimatedTpd: row.estimated_tpd,
  })));
});

analyticsExtraRouter.get('/usage/minute', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT * FROM provider_usage_minute
    ORDER BY minute_bucket DESC, total_tokens DESC
    LIMIT 500
  `).all() as any[];
  res.json(rows.map(row => ({
    id: row.id,
    providerSlug: row.provider_slug,
    providerAccountId: row.provider_account_id,
    modelId: row.provider_model_id,
    minuteBucket: row.minute_bucket,
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
  })));
});

analyticsExtraRouter.get('/model-changes', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT * FROM model_change_events
    ORDER BY detected_at DESC
    LIMIT 100
  `).all() as any[];
  res.json(rows.map(row => ({
    id: row.id,
    providerSlug: row.provider_slug,
    modelId: row.provider_model_id,
    changeType: row.change_type,
    oldValue: row.old_value_json ? JSON.parse(row.old_value_json) : null,
    newValue: row.new_value_json ? JSON.parse(row.new_value_json) : null,
    detectedAt: row.detected_at,
  })));
});

analyticsExtraRouter.get('/broker/live', (_req: Request, res: Response) => {
  ensureSchema();
  const db = getDb();

  const requestStats = db.prepare(`
    SELECT
      COUNT(*) AS requests_5m,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_5m,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_5m,
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens_5m,
      ROUND(AVG(latency_ms)) AS avg_latency_ms
    FROM requests
    WHERE created_at >= datetime('now', '-5 minutes')
  `).get() as any;

  const activeSessions = db.prepare(`
    SELECT COUNT(*) AS count
    FROM request_sessions
    WHERE last_seen_at >= datetime('now', '-30 minutes')
  `).get() as { count: number };

  const clientMix = db.prepare(`
    SELECT COALESCE(client_profile, 'unknown') AS client_profile, COUNT(*) AS count
    FROM route_decisions
    WHERE created_at >= datetime('now', '-1 hour')
    GROUP BY COALESCE(client_profile, 'unknown')
    ORDER BY count DESC
  `).all() as any[];

  const workloadMix = db.prepare(`
    SELECT workload, COUNT(*) AS count
    FROM route_decisions
    WHERE created_at >= datetime('now', '-1 hour')
    GROUP BY workload
    ORDER BY count DESC
  `).all() as any[];

  const routeTimeline = db.prepare(`
    SELECT
      strftime('%H:%M', created_at) AS minute,
      COUNT(*) AS routes,
      SUM(CASE WHEN selected_model_id IS NOT NULL THEN 1 ELSE 0 END) AS routed,
      SUM(CASE WHEN selected_model_id IS NULL THEN 1 ELSE 0 END) AS unrouted
    FROM route_decisions
    WHERE created_at >= datetime('now', '-60 minutes')
    GROUP BY strftime('%Y-%m-%d %H:%M', created_at)
    ORDER BY MIN(created_at) ASC
  `).all() as any[];

  const recentDecisions = db.prepare(`
    SELECT request_id, client_profile, workload, selected_provider_slug, selected_model_id,
           fallback_attempts, route_reason_json, winner_reason, created_at
    FROM route_decisions
    ORDER BY created_at DESC
    LIMIT 25
  `).all() as any[];

  const lifecycle = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM provider_catalog_models
    GROUP BY status
    ORDER BY count DESC
  `).all() as any[];

  const probeHealth = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM model_probe_results
    WHERE created_at >= datetime('now', '-24 hours')
    GROUP BY status
    ORDER BY count DESC
  `).all() as any[];

  const recentModelChanges = db.prepare(`
    SELECT provider_slug, provider_model_id, change_type, detected_at
    FROM model_change_events
    ORDER BY detected_at DESC
    LIMIT 12
  `).all() as any[];

  res.json({
    requestStats: {
      requests5m: requestStats.requests_5m ?? 0,
      success5m: requestStats.success_5m ?? 0,
      error5m: requestStats.error_5m ?? 0,
      tokens5m: requestStats.tokens_5m ?? 0,
      avgLatencyMs: requestStats.avg_latency_ms ?? 0,
    },
    activeSessions: activeSessions.count,
    clientMix: clientMix.map(row => ({ clientProfile: row.client_profile, count: row.count })),
    workloadMix: workloadMix.map(row => ({ workload: row.workload, count: row.count })),
    routeTimeline: routeTimeline.map(row => ({
      minute: row.minute,
      routes: row.routes,
      routed: row.routed ?? 0,
      unrouted: row.unrouted ?? 0,
    })),
    recentDecisions: recentDecisions.map(row => {
      const routeReason = row.route_reason_json ? JSON.parse(row.route_reason_json) : {};
      return {
        requestId: row.request_id,
        clientProfile: row.client_profile,
        workload: row.workload,
        providerSlug: row.selected_provider_slug,
        modelId: row.selected_model_id,
        fallbackAttempts: row.fallback_attempts,
        routeReason,
        winnerReason: row.winner_reason,
        createdAt: row.created_at,
      };
    }),
    lifecycle: lifecycle.map(row => ({ status: row.status, count: row.count })),
    probeHealth: probeHealth.map(row => ({ status: row.status, count: row.count })),
    recentModelChanges: recentModelChanges.map(row => ({
      providerSlug: row.provider_slug,
      modelId: row.provider_model_id,
      changeType: row.change_type,
      detectedAt: row.detected_at,
    })),
  });
});

analyticsExtraRouter.get('/broker/decisions', (req: Request, res: Response) => {
  ensureSchema();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const rows = getDb().prepare(`
    SELECT *
    FROM route_decisions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  res.json(rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    sessionHash: row.session_hash,
    clientProfile: row.client_profile,
    workload: row.workload,
    providerSlug: row.selected_provider_slug,
    modelId: row.selected_model_id,
    candidateModels: row.candidate_models_json ? JSON.parse(row.candidate_models_json) : [],
    routeReason: row.route_reason_json ? JSON.parse(row.route_reason_json) : {},
    fallbackAttempts: row.fallback_attempts,
    racedModels: row.raced_models_json ? JSON.parse(row.raced_models_json) : [],
    winnerReason: row.winner_reason,
    createdAt: row.created_at,
  })));
});

analyticsExtraRouter.get('/broker/scores', (_req: Request, res: Response) => {
  ensureSchema();
  const rows = getDb().prepare(`
    SELECT provider_slug, provider_model_id, workload, reliability_score, latency_score,
           quality_score, tool_score, json_score, headroom_score, final_score,
           sample_count, updated_at
    FROM model_workload_scores
    ORDER BY workload ASC, final_score DESC
    LIMIT 500
  `).all() as any[];

  res.json(rows.map(row => ({
    providerSlug: row.provider_slug,
    modelId: row.provider_model_id,
    workload: row.workload,
    reliabilityScore: row.reliability_score,
    latencyScore: row.latency_score,
    qualityScore: row.quality_score,
    toolScore: row.tool_score,
    jsonScore: row.json_score,
    headroomScore: row.headroom_score,
    finalScore: row.final_score,
    sampleCount: row.sample_count,
    updatedAt: row.updated_at,
  })));
});
