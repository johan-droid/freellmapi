import { getDb } from '../db/index.js';
import { getAllAdapters, getAdapter } from '../providers/registry.js';
import type { DiscoverySummaryDto } from '@freellmapi/shared/types.js';
import { decrypt } from '../lib/crypto.js';

export interface DiscoveryOptions {
  provider?: string;
  providerAccountId?: number;
  force?: boolean;
}

export async function runModelDiscovery(options: DiscoveryOptions = {}): Promise<DiscoverySummaryDto> {
  const db = getDb();

  const summary: DiscoverySummaryDto = {
    providersChecked: 0,
    accountsChecked: 0,
    credentialsChecked: 0,
    modelsAdded: 0,
    modelsUpdated: 0,
    modelsRemoved: 0,
    modelsRestored: 0,
    quotaChanges: 0,
    metadataChanges: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    finishedAt: ''
  };

  let credQuery = `
    SELECT c.id, c.provider_account_id, c.provider, c.label, c.encrypted_key, c.iv, c.auth_tag, c.base_url, c.enabled, c.status
    FROM provider_credentials c
    JOIN provider_accounts a ON c.provider_account_id = a.id
    WHERE c.enabled = 1 AND a.enabled = 1
  `;
  const params: any[] = [];

  if (options.provider) {
    credQuery += ` AND c.provider = ?`;
    params.push(options.provider);
  }
  if (options.providerAccountId) {
    credQuery += ` AND c.provider_account_id = ?`;
    params.push(options.providerAccountId);
  }

  const credentials = db.prepare(credQuery).all(...params) as any[];

  for (const cred of credentials) {
    summary.credentialsChecked++;
    const adapter = getAdapter(cred.provider);
    if (!adapter || !adapter.supportsModelListing || !adapter.listModels) {
      continue;
    }

    try {
      const decryptedKey = decrypt(cred.encrypted_key, cred.iv, cred.auth_tag);

      const discoveredModels = await adapter.listModels({
        id: cred.id,
        providerAccountId: cred.provider_account_id,
        provider: cred.provider,
        label: cred.label,
        decryptedKey: decryptedKey,
        baseUrl: cred.base_url,
        enabled: cred.enabled === 1,
        status: cred.status
      });


      // Upsert logic
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const insertSnapshot = db.prepare(`
        INSERT INTO provider_model_snapshots
        (provider, provider_account_id, model_id, display_name, raw_json, discovered_at, last_seen_at, context_window, supports_vision, supports_tools, supports_streaming)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, provider_account_id, model_id) DO UPDATE SET
        display_name=excluded.display_name, raw_json=excluded.raw_json, last_seen_at=excluded.last_seen_at,
        context_window=excluded.context_window, supports_vision=excluded.supports_vision,
        supports_tools=excluded.supports_tools, supports_streaming=excluded.supports_streaming, status='active'
      `);

      const getModel = db.prepare('SELECT id, display_name, context_window, supports_vision FROM models WHERE platform = ? AND model_id = ?');
      const insertModel = db.prepare(`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, context_window, supports_vision, dynamic, discovered_source, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateModel = db.prepare(`
        UPDATE models SET display_name = ?, context_window = ?, supports_vision = ?, dynamic = 1, discovered_source = 'provider_api', last_seen_at = ?, deprecated = 0, unavailable_since = NULL
        WHERE id = ?
      `);

      const insertFallback = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
      const getMaxPriority = db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config');

      db.transaction(() => {
        for (const model of discoveredModels) {
          insertSnapshot.run(
            model.provider,
            cred.provider_account_id,
            model.modelId,
            model.displayName,
            model.raw ? JSON.stringify(model.raw) : null,
            now,
            now,
            model.contextWindow || null,
            model.supportsVision ? 1 : 0,
            model.supportsTools ? 1 : 0,
            model.supportsStreaming ? 1 : 0
          );


          const existingModel = getModel.get(model.provider, model.modelId) as any;
          if (existingModel) {
            updateModel.run(model.displayName, model.contextWindow || null, model.supportsVision ? 1 : 0, now, existingModel.id);
            summary.modelsUpdated++;
          } else {
             const info = insertModel.run(
                model.provider,
                model.modelId,
                model.displayName,
                50, // default low rank
                50, // default low speed
                'Unknown',
                model.contextWindow || null,
                model.supportsVision ? 1 : 0,
                1,
                'provider_api',
                now
             );
             summary.modelsAdded++;
             const mx = (getMaxPriority.get() as any).mx;
             insertFallback.run(info.lastInsertRowid, mx + 1);
          }
        }
      })();

      // Deprecation check for this provider + credential pair
      const deprecationCutoffHours = parseInt(process.env.MODEL_DISCOVERY_MARK_REMOVED_AFTER_HOURS || '24', 10);
      const deprecationCutoffMs = nowMs - (deprecationCutoffHours * 60 * 60 * 1000);
      const deprecationDate = new Date(deprecationCutoffMs).toISOString();

      const markDeprecated = db.prepare(`
        UPDATE models SET deprecated = 1, unavailable_since = ?
        WHERE platform = ? AND dynamic = 1 AND deprecated = 0 AND discovered_source = 'provider_api'
        AND last_seen_at < ?
      `);

      const insertChangeEvent = db.prepare(`
        INSERT INTO model_change_events (provider, provider_account_id, model_id, event_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        // Find which ones we are deprecating to record events
        const toDeprecate = db.prepare(`
          SELECT model_id FROM models
          WHERE platform = ? AND dynamic = 1 AND deprecated = 0 AND discovered_source = 'provider_api'
          AND last_seen_at < ?
        `).all(cred.provider, deprecationDate) as { model_id: string }[];

        if (toDeprecate.length > 0) {
           markDeprecated.run(now, cred.provider, deprecationDate);
           for (const m of toDeprecate) {
             insertChangeEvent.run(cred.provider, cred.provider_account_id, m.model_id, 'removed', now);
             summary.modelsRemoved++;
           }
        }
      })();

      console.log(`Discovered ${discoveredModels.length} models for ${cred.provider}`);



    } catch (err: any) {
      console.error(`[Discovery] Failed for ${cred.provider} credential ${cred.id}:`, err.message);
      summary.errors++;
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}
