import { getDb } from '../db/index.js';
import type { ProviderCapacityDto, ProviderAnalyticsDto } from '@freellmapi/shared/types.js';

export function getProviderCapacity(): ProviderCapacityDto[] {
  const db = getDb();

  const query = `
    SELECT
      p.provider,
      COUNT(DISTINCT p.id) as activeAccounts,
      COUNT(DISTINCT c.id) as activeCredentials,
      (SELECT COUNT(*) FROM models WHERE platform = p.provider AND enabled = 1 AND deprecated = 0) as activeModels,
      (SELECT COUNT(*) FROM models WHERE platform = p.provider AND deprecated = 1) as deprecatedModels,
      (SELECT COUNT(*) FROM model_change_events WHERE provider = p.provider AND event_type = 'added' AND created_at > datetime('now', '-7 days')) as newModels7d,
      (SELECT COUNT(*) FROM model_change_events WHERE provider = p.provider AND event_type = 'removed' AND created_at > datetime('now', '-30 days')) as removedModels30d
    FROM provider_accounts p
    LEFT JOIN provider_credentials c ON c.provider_account_id = p.id AND c.enabled = 1
    WHERE p.enabled = 1
    GROUP BY p.provider
  `;

  const rows = db.prepare(query).all() as any[];

  return rows.map(r => ({
    provider: r.provider,
    activeAccounts: r.activeAccounts,
    activeCredentials: r.activeCredentials,
    activeModels: r.activeModels,
    deprecatedModels: r.deprecatedModels,
    newModels7d: r.newModels7d,
    removedModels30d: r.removedModels30d,
    rpmLimitTotal: null,
    rpdLimitTotal: null,
    tpmLimitTotal: null,
    tpdLimitTotal: null,
    rpmUsedCurrentMinute: 0,
    rpdUsedToday: 0,
    tpmUsedCurrentMinute: 0,
    tpdUsedToday: 0,
    estimatedRemainingToday: null,
    estimatedMonthlyBudget: null,
  }));
}

export function getProviderDetail(provider: string): ProviderAnalyticsDto {
  const db = getDb();

  const accounts = db.prepare('SELECT id, provider, label, email_hint as emailHint, status, enabled, created_at as createdAt, updated_at as updatedAt, last_checked_at as lastCheckedAt FROM provider_accounts WHERE provider = ?').all(provider) as any[];
  const credentials = db.prepare('SELECT id, provider_account_id as providerAccountId, provider, label, base_url as baseUrl, status, enabled, created_at as createdAt, last_checked_at as lastCheckedAt FROM provider_credentials WHERE provider = ?').all(provider) as any[];
  const models = db.prepare('SELECT id, platform as provider, model_id as modelId, display_name as displayName, enabled, deprecated, dynamic, discovered_source as discoveredSource, last_seen_at as lastSeenAt, unavailable_since as unavailableSince, context_window as contextWindow, supports_vision as supportsVision, supports_tools as supportsTools, supports_streaming as supportsStreaming FROM models WHERE platform = ?').all(provider) as any[];

  // Convert SQLite integers 0/1 back to boolean
  const formattedModels = models.map(m => ({
    ...m,
    enabled: m.enabled === 1,
    deprecated: m.deprecated === 1,
    dynamic: m.dynamic === 1,
    supportsVision: m.supportsVision === 1,
    supportsTools: m.supportsTools === 1,
    supportsStreaming: m.supportsStreaming === 1
  }));

  const capacity = getProviderCapacity().find(c => c.provider === provider) || {
    provider,
    activeAccounts: 0,
    activeCredentials: 0,
    activeModels: 0,
    deprecatedModels: 0,
    newModels7d: 0,
    removedModels30d: 0,
    rpmLimitTotal: null,
    rpdLimitTotal: null,
    tpmLimitTotal: null,
    tpdLimitTotal: null,
    rpmUsedCurrentMinute: 0,
    rpdUsedToday: 0,
    tpmUsedCurrentMinute: 0,
    tpdUsedToday: 0,
    estimatedRemainingToday: null,
    estimatedMonthlyBudget: null
  };

  return {
    provider,
    accounts,
    credentials: credentials.map(c => ({...c, maskedKeyPreview: '****'})),
    models: formattedModels,
    capacity,
    usage: {},
    health: [],
    modelChanges: []
  };
}
