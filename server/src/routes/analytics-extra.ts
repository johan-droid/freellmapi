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
