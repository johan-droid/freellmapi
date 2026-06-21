import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { hasProvider } from '../providers/index.js';

export const modelsRouter = Router();

// List all models with availability info
modelsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare(`
    SELECT
      m.*,
      fc.priority,
      fc.enabled as fallback_enabled,
      pcm.status as catalog_status,
      pcm.last_seen_at as catalog_last_seen_at,
      pcm.last_probe_at as catalog_last_probe_at,
      COALESCE(k.active_key_count, 0) as active_key_count,
      COALESCE(k.healthy_key_count, 0) as healthy_key_count,
      COALESCE(k.error_key_count, 0) as error_key_count,
      COALESCE(k.rate_limited_key_count, 0) as rate_limited_key_count,
      probe.status as last_probe_status,
      probe.created_at as last_probe_at,
      COALESCE(probe24.total_probes_24h, 0) as total_probes_24h,
      COALESCE(probe24.failed_probes_24h, 0) as failed_probes_24h
    FROM models m
    LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
    LEFT JOIN provider_catalog_models pcm
      ON pcm.provider_slug = m.platform AND pcm.provider_model_id = m.model_id
    LEFT JOIN (
      SELECT
        platform,
        COUNT(*) as active_key_count,
        SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_key_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_key_count,
        SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_key_count
      FROM api_keys
      WHERE enabled = 1
      GROUP BY platform
    ) k ON k.platform = m.platform
    LEFT JOIN (
      SELECT p1.provider_slug, p1.provider_model_id, p1.status, p1.created_at
      FROM model_probe_results p1
      JOIN (
        SELECT provider_slug, provider_model_id, MAX(created_at) as max_created_at
        FROM model_probe_results
        GROUP BY provider_slug, provider_model_id
      ) latest
        ON latest.provider_slug = p1.provider_slug
       AND latest.provider_model_id = p1.provider_model_id
       AND latest.max_created_at = p1.created_at
    ) probe
      ON probe.provider_slug = m.platform AND probe.provider_model_id = m.model_id
    LEFT JOIN (
      SELECT
        provider_slug,
        provider_model_id,
        COUNT(*) as total_probes_24h,
        SUM(CASE WHEN status IN ('fail', 'error', 'timeout', 'rate_limited') THEN 1 ELSE 0 END) as failed_probes_24h
      FROM model_probe_results
      WHERE created_at >= datetime('now', '-24 hours')
      GROUP BY provider_slug, provider_model_id
    ) probe24
      ON probe24.provider_slug = m.platform AND probe24.provider_model_id = m.model_id
    ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
  `).all() as any[];

  const result = models.map(m => ({
    id: m.id,
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    intelligenceRank: m.intelligence_rank,
    speedRank: m.speed_rank,
    sizeLabel: m.size_label,
    rpmLimit: m.rpm_limit,
    rpdLimit: m.rpd_limit,
    tpmLimit: m.tpm_limit,
    tpdLimit: m.tpd_limit,
    monthlyTokenBudget: m.monthly_token_budget,
    contextWindow: m.context_window,
    enabled: m.enabled === 1,
    supportsVision: m.supports_vision === 1,
    supportsTools: m.supports_tools === 1,
    codingBias: m.coding_bias === 1,
    researchBias: m.research_bias === 1,
    chatBias: m.chat_bias === 1,
    priority: m.priority,
    fallbackEnabled: m.fallback_enabled === 1,
    hasProvider: hasProvider(m.platform),
    keyCount: m.active_key_count ?? 0,
    activeKeyCount: m.active_key_count ?? 0,
    healthyKeyCount: m.healthy_key_count ?? 0,
    errorKeyCount: m.error_key_count ?? 0,
    rateLimitedKeyCount: m.rate_limited_key_count ?? 0,
    catalogStatus: m.catalog_status ?? null,
    catalogLastSeenAt: m.catalog_last_seen_at ?? null,
    catalogLastProbeAt: m.catalog_last_probe_at ?? null,
    lastProbeStatus: m.last_probe_status ?? null,
    lastProbeAt: m.last_probe_at ?? null,
    totalProbes24h: m.total_probes_24h ?? 0,
    failedProbes24h: m.failed_probes_24h ?? 0,
    recentDowntime24h: (m.failed_probes_24h ?? 0) > 0,
    routable:
      m.enabled === 1
      && m.fallback_enabled === 1
      && (m.catalog_status == null || m.catalog_status === 'active' || m.catalog_status === 'candidate')
      && (m.active_key_count ?? 0) > 0,
  }));

  res.json(result);
});
