import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { checkKeyHealth, checkAllKeys } from '../services/health.js';
import { hasProvider } from '../providers/index.js';
import { getQuotaStateForKeys } from '../services/provider-quota.js';
import { scheduleHydrateSecretsToRemote } from '../services/remote-secrets.js';

export const healthRouter = Router();

// Get health status for all platforms
healthRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();

  const platforms = db.prepare(`
    SELECT
      platform,
      COUNT(*) as total_keys,
      SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_keys,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_keys,
      SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid_keys,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_keys,
      SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_keys,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_keys
    FROM api_keys
    GROUP BY platform
  `).all() as any[];

  const keys = db.prepare(`
    SELECT id, platform, label, status, enabled, created_at, last_checked_at
    FROM api_keys
    ORDER BY platform, created_at DESC
  `).all() as any[];

  const routingOverview = db.prepare(`
    SELECT
      COUNT(*) as total_models,
      SUM(CASE WHEN m.enabled = 1 THEN 1 ELSE 0 END) as enabled_models,
      SUM(CASE WHEN fc.enabled = 1 THEN 1 ELSE 0 END) as chain_enabled_models,
      SUM(CASE WHEN (pcm.status IS NULL OR pcm.status IN ('active', 'candidate')) THEN 1 ELSE 0 END) as catalog_live_models,
      SUM(CASE WHEN fc.enabled = 1
                AND m.enabled = 1
                AND (pcm.status IS NULL OR pcm.status IN ('active', 'candidate'))
                AND EXISTS (
                  SELECT 1
                  FROM api_keys ak
                  WHERE ak.platform = m.platform
                    AND ak.enabled = 1
                )
          THEN 1 ELSE 0 END) as routable_models
    FROM models m
    LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
    LEFT JOIN provider_catalog_models pcm
      ON pcm.provider_slug = m.platform AND pcm.provider_model_id = m.model_id
  `).get() as any;

  const downtimeOverview = db.prepare(`
    SELECT
      COUNT(*) as probe_rows_24h,
      SUM(CASE WHEN status IN ('fail', 'error', 'timeout', 'rate_limited') THEN 1 ELSE 0 END) as failed_probe_rows_24h,
      COUNT(DISTINCT CASE WHEN status IN ('fail', 'error', 'timeout', 'rate_limited') THEN provider_slug || '::' || provider_model_id END) as models_with_downtime_24h
    FROM model_probe_results
    WHERE created_at >= datetime('now', '-24 hours')
  `).get() as any;

  res.json({
    platforms: platforms.map(p => ({
      platform: p.platform,
      hasProvider: hasProvider(p.platform),
      totalKeys: p.total_keys,
      healthyKeys: p.healthy_keys,
      rateLimitedKeys: p.rate_limited_keys,
      invalidKeys: p.invalid_keys,
      errorKeys: p.error_keys,
      unknownKeys: p.unknown_keys,
      enabledKeys: p.enabled_keys,
    })),
    keys: keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      lastCheckedAt: k.last_checked_at,
    })),
    quotaStates: getQuotaStateForKeys(),
    routingOverview: {
      totalModels: routingOverview.total_models ?? 0,
      enabledModels: routingOverview.enabled_models ?? 0,
      chainEnabledModels: routingOverview.chain_enabled_models ?? 0,
      catalogLiveModels: routingOverview.catalog_live_models ?? 0,
      routableModels: routingOverview.routable_models ?? 0,
    },
    downtimeOverview: {
      probeRows24h: downtimeOverview.probe_rows_24h ?? 0,
      failedProbeRows24h: downtimeOverview.failed_probe_rows_24h ?? 0,
      modelsWithDowntime24h: downtimeOverview.models_with_downtime_24h ?? 0,
    },
  });
});

// Check a specific key
healthRouter.post('/check/:keyId', async (req: Request, res: Response) => {
  const keyId = parseInt(req.params.keyId as string, 10);
  if (isNaN(keyId)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const status = await checkKeyHealth(keyId);
  scheduleHydrateSecretsToRemote(getDb());
  res.json({ keyId, status });
});

// Check all keys
healthRouter.post('/check-all', async (_req: Request, res: Response) => {
  await checkAllKeys();
  scheduleHydrateSecretsToRemote(getDb());
  res.json({ success: true });
});
