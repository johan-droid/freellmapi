import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { hasProvider } from '../providers/index.js';

export const modelsRouter = Router();

// List all models with availability info
modelsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare(`
    SELECT m.*, fc.priority, fc.enabled as fallback_enabled
    FROM models m
    LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
    ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
  `).all() as any[];

  // Count credentials per platform instead of legacy keys
  const credentialCounts = db.prepare(`
    SELECT provider as platform, COUNT(*) as count
    FROM provider_credentials
    WHERE enabled = 1
    GROUP BY provider
  `).all() as { platform: string; count: number }[];

  const keyCountMap = new Map(credentialCounts.map(k => [k.platform, k.count]));

  const providerAccounts = db.prepare(`
    SELECT id, provider, label, email_hint, enabled, status
    FROM provider_accounts
  `).all() as any[];

  const credentials = db.prepare(`
    SELECT id, provider_account_id, provider, label, enabled, status
    FROM provider_credentials
  `).all() as any[];

  // Note: we map provider_accounts and credentials
  const accountsByProvider = new Map<string, any[]>();

  for (const acc of providerAccounts) {
    if (!accountsByProvider.has(acc.provider)) {
      accountsByProvider.set(acc.provider, []);
    }
    const accCreds = credentials
      .filter(c => c.provider_account_id === acc.id)
      .map(c => ({
        id: c.id,
        label: c.label,
        enabled: c.enabled === 1,
        status: c.status,
        cooldownUntil: null,
        quota: {
          quotaStatus: 'unknown',
          quotaSource: 'unknown',
          quotaConfidence: 'unknown'
        }
      }));

    accountsByProvider.get(acc.provider)!.push({
      id: acc.id,
      label: acc.label,
      emailHint: acc.email_hint,
      enabled: acc.enabled === 1,
      status: acc.status,
      credentials: accCreds,
      quota: {
        quotaStatus: 'unknown',
        quotaSource: 'unknown',
        quotaConfidence: 'unknown'
      },
      modelAvailability: {
        active: true,
        lastSeenAt: null,
        unavailableSince: null,
        credentialIds: accCreds.map(c => c.id)
      }
    });
  }

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
    supportsStreaming: m.supports_streaming === 1,
    priority: m.priority,
    fallbackEnabled: m.fallback_enabled === 1,
    hasProvider: hasProvider(m.platform),
    keyCount: keyCountMap.get(m.platform) ?? 0,
    dynamic: m.dynamic === 1,
    deprecated: m.deprecated === 1,
    discoveredSource: m.discovered_source,
    lastSeenAt: m.last_seen_at,
    unavailableSince: m.unavailable_since,
    providerAccounts: accountsByProvider.get(m.platform) || []
  }));

  res.json(result);
});
