import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { scheduleHydrateSecretsToRemote } from '../services/remote-secrets.js';
import { resolveProvider } from '../providers/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import { getKeyActivitySummaryMap } from '../services/key-activity.js';

export const keysRouter = Router();

function parseOptionsJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
// Moonshot and MiniMax direct integrations were dropped in V4. HuggingFace
// was dropped in V4 and re-added in V13 via the router.huggingface.co route.
// SambaNova was dropped in V23 (free tier permanently retired).
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'huggingface', 'opencode', 'ovh', 'agnes', 'reka', 'siliconflow',
  'routeway', 'bazaarlink', 'ainative', 'aihorde', 'custom',
] as const;

// `key` is optional so keyless providers (Kilo's anonymous gateway) can be added
// without one; the handler enforces a non-empty key for everyone else.
const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().optional(),
  label: z.string().optional(),
  accountName: z.string().optional(),
  accountEmail: z.string().email().optional(),
  externalId: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
  accountName: z.string().nullable().optional(),
  accountEmail: z.string().email().nullable().optional(),
  externalId: z.string().nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
}).refine(data =>
  data.enabled !== undefined
  || data.label !== undefined
  || data.accountName !== undefined
  || data.accountEmail !== undefined
  || data.externalId !== undefined
  || data.options !== undefined,
{
  message: 'At least one field must be provided',
});

// List all keys (masked)
keysRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];
  const activityByKeyId = getKeyActivitySummaryMap(db);

  const customModels = [
    ...db.prepare(`
      SELECT key_id, id, 'chat' AS kind, model_id, display_name, NULL AS family
        FROM models
       WHERE platform = 'custom' AND key_id IS NOT NULL
    `).all() as any[],
    ...db.prepare(`
      SELECT key_id, id, 'embedding' AS kind, model_id, display_name, family
        FROM embedding_models
       WHERE platform = 'custom' AND key_id IS NOT NULL
    `).all() as any[],
    ...db.prepare(`
      SELECT key_id, id, modality AS kind, model_id, display_name, NULL AS family
        FROM media_models
       WHERE platform = 'custom' AND key_id IS NOT NULL
    `).all() as any[],
  ];
  const modelsByKeyId = new Map<number, any[]>();
  for (const m of customModels) {
    const keyId = Number(m.key_id);
    if (!Number.isInteger(keyId)) continue;
    const list = modelsByKeyId.get(keyId) ?? [];
    list.push({
      id: m.id,
      kind: m.kind,
      modelId: m.model_id,
      displayName: m.display_name,
      family: m.family ?? null,
    });
    modelsByKeyId.set(keyId, list);
  }
  for (const list of modelsByKeyId.values()) {
    list.sort((a, b) => {
      const ka = ['chat', 'embedding', 'image', 'audio'].indexOf(a.kind);
      const kb = ['chat', 'embedding', 'image', 'audio'].indexOf(b.kind);
      return (ka - kb) || String(a.displayName).localeCompare(String(b.displayName));
    });
  }

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    const activity = activityByKeyId.get(row.id) ?? {
      keyId: row.id,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      lastRoutedAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    };
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      accountName: row.account_name ?? null,
      accountEmail: row.account_email ?? null,
      externalId: row.external_id ?? null,
      options: parseOptionsJson(row.options_json),
      maskedKey,
      baseUrl: row.base_url ?? null,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
      activity: {
        requestCount: activity.requestCount,
        successCount: activity.successCount,
        errorCount: activity.errorCount,
        lastRoutedAt: activity.lastRoutedAt,
        lastSuccessAt: activity.lastSuccessAt,
        lastErrorAt: activity.lastErrorAt,
        lastErrorMessage: activity.lastErrorMessage,
      },
      models: row.platform === 'custom' ? (modelsByKeyId.get(row.id) ?? []) : undefined,
    };
  });

  keys.sort((a, b) => {
    const aLast = a.activity.lastRoutedAt ?? a.lastCheckedAt ?? a.createdAt;
    const bLast = b.activity.lastRoutedAt ?? b.lastCheckedAt ?? b.createdAt;
    if (aLast !== bLast) return String(bLast).localeCompare(String(aLast));
    return b.id - a.id;
  });

  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, label } = parsed.data;
  const accountName = parsed.data.accountName?.trim() || null;
  const accountEmail = parsed.data.accountEmail?.trim() || null;
  const externalId = parsed.data.externalId?.trim() || null;
  const optionsJson = JSON.stringify(parsed.data.options ?? {});
  const isKeyless = resolveProvider(platform)?.keyless === true;
  const rawKey = parsed.data.key?.trim() ?? '';

  if (!isKeyless && !rawKey) {
    res.status(400).json({ error: { message: 'key is required' } });
    return;
  }

  // Keyless providers (Kilo anon) store a sentinel so routing sees the platform
  // as configured; the provider omits the auth header on outgoing calls.
  const keyToStore = isKeyless ? (rawKey || 'no-key') : rawKey;

  const db = getDb();

  // A keyless provider needs only one sentinel row — re-enable an existing one
  // instead of piling up duplicates each time the user clicks "Add".
  if (isKeyless) {
    const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ? LIMIT 1').get(platform) as { id: number } | undefined;
    if (existing) {
      db.prepare(`
        UPDATE api_keys
           SET enabled = 1,
               status = 'unknown',
               label = ?,
               account_name = ?,
               account_email = ?,
               external_id = ?,
               options_json = ?
         WHERE id = ?
      `).run(label ?? '', accountName, accountEmail, externalId, optionsJson, existing.id);
      scheduleHydrateSecretsToRemote(db);
      res.status(200).json({
        id: existing.id,
        platform,
        label: label ?? '',
        accountName,
        accountEmail,
        externalId,
        options: parsed.data.options ?? {},
        maskedKey: maskKey(keyToStore),
        status: 'unknown',
        enabled: true,
      });
      return;
    }
  }

  const { encrypted, iv, authTag } = encrypt(keyToStore);
  const result = db.prepare(`
    INSERT INTO api_keys (platform, label, account_name, account_email, external_id, encrypted_key, iv, auth_tag, status, enabled, options_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 1, ?)
  `).run(platform, label ?? '', accountName, accountEmail, externalId, encrypted, iv, authTag, optionsJson);
  scheduleHydrateSecretsToRemote(db);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    label: label ?? '',
    accountName,
    accountEmail,
    externalId,
    options: parsed.data.options ?? {},
    maskedKey: maskKey(keyToStore),
    status: 'unknown',
    enabled: true,
  });
});

// ── Custom OpenAI-compatible providers (#117, #212) ───────────────────────
// User-configured endpoints (llama.cpp / LM Studio / vLLM / Ollama / any
// OpenAI-compatible base_url). Each DISTINCT base_url gets its own 'custom'
// api_keys row, and every registered model binds to its endpoint's key via
// models.key_id — so several custom providers coexist without overwriting
// each other (#212). Re-submitting an existing base_url updates its key/label;
// re-registering an existing model id re-binds it to the submitted endpoint.
// A model can be given as a bare id ("qwen3:4b") or as {model, displayName}.
// `model`/`displayName` (singular) stay supported for older clients; `models`
// (plural) lets one submit bind several model ids to the same endpoint. (#281)
const modelEntrySchema = z.union([
  z.string().min(1),
  z.object({ model: z.string().min(1), displayName: z.string().optional() }),
]);
const customProviderSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  model: z.string().optional(),
  models: z.array(modelEntrySchema).optional(),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  label: z.string().optional(),
  accountName: z.string().optional(),
  accountEmail: z.string().email().optional(),
  externalId: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
}).refine(
  d => (d.model && d.model.trim().length > 0) || (d.models && d.models.length > 0),
  { message: 'model or models is required' },
);

keysRouter.post('/custom', (req: Request, res: Response) => {
  const parsed = customProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  // Local servers often need no key; keep a sentinel so there's always a bearer.
  const providedKey = parsed.data.apiKey?.trim() || undefined;
  const label = parsed.data.label?.trim() || 'Custom';
  const accountName = parsed.data.accountName?.trim() || null;
  const accountEmail = parsed.data.accountEmail?.trim() || null;
  const externalId = parsed.data.externalId?.trim() || null;
  const optionsJson = JSON.stringify(parsed.data.options ?? {});

  // Flatten singular + plural inputs into one list, dedupe by model id, drop
  // blanks. The singular `displayName` only applies to a lone `model` (it can't
  // sensibly fan out across many ids).
  const entries: { modelId: string; displayName: string }[] = [];
  const seen = new Set<string>();
  const addEntry = (rawId: string, rawDisplay?: string) => {
    const modelId = rawId.trim();
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    entries.push({ modelId, displayName: (rawDisplay?.trim() || modelId) });
  };
  if (parsed.data.model?.trim()) addEntry(parsed.data.model, parsed.data.displayName);
  for (const m of parsed.data.models ?? []) {
    if (typeof m === 'string') addEntry(m);
    else addEntry(m.model, m.displayName);
  }

  if (entries.length === 0) {
    res.status(400).json({ error: { message: 'model or models is required' } });
    return;
  }

  const db = getDb();
  const upsert = db.transaction(() => {
    // One 'custom' key row PER ENDPOINT (matched on base_url). Re-submitting
    // the same endpoint updates its key/label; a new base_url gets its own
// row instead of clobbering the previous provider. (#212) Re-submitting with a
// blank key preserves the stored key; only a provided key updates credentials.
    const existing = db.prepare("SELECT id, encrypted_key, iv, auth_tag FROM api_keys WHERE platform = 'custom' AND base_url = ? LIMIT 1")
      .get(baseUrl) as { id: number; encrypted_key: string; iv: string; auth_tag: string } | undefined;
    let keyId: number;
    let storedKeyForMask = providedKey ?? 'no-key';
    if (existing) {
      keyId = existing.id;
      if (providedKey) {
        const { encrypted, iv, authTag } = encrypt(providedKey);
        db.prepare(`
          UPDATE api_keys
             SET label = COALESCE(?, label),
                 account_name = ?,
                 account_email = ?,
                 external_id = ?,
                 encrypted_key = ?,
                 iv = ?,
                 auth_tag = ?,
                 status = 'unknown',
                 enabled = 1,
                 options_json = ?
           WHERE id = ?
        `).run(label, accountName, accountEmail, externalId, encrypted, iv, authTag, optionsJson, existing.id);
        storedKeyForMask = providedKey;
      } else {
        try {
          storedKeyForMask = decrypt(existing.encrypted_key, existing.iv, existing.auth_tag);
        } catch {
          storedKeyForMask = 'no-key';
        }
        db.prepare(`
          UPDATE api_keys
             SET label = COALESCE(?, label),
                 account_name = ?,
                 account_email = ?,
                 external_id = ?,
                 status = 'unknown',
                 enabled = 1,
                 options_json = ?
           WHERE id = ?
        `).run(label, accountName, accountEmail, externalId, optionsJson, existing.id);
      }
    } else {
      const keyToStore = providedKey ?? 'no-key';
      const { encrypted, iv, authTag } = encrypt(keyToStore);
      const r = db.prepare(`
        INSERT INTO api_keys (platform, label, account_name, account_email, external_id, encrypted_key, iv, auth_tag, status, enabled, base_url, options_json)
        VALUES ('custom', ?, ?, ?, ?, ?, ?, ?, 'unknown', 1, ?, ?)
      `).run(label, accountName, accountEmail, externalId, encrypted, iv, authTag, baseUrl, optionsJson);
      keyId = Number(r.lastInsertRowid);
      storedKeyForMask = keyToStore;
    }

    const registered: { modelDbId: number; model: string; displayName: string }[] = [];
    for (const { modelId, displayName } of entries) {
      // Register each model bound to THIS endpoint's key. Custom models carry no
      // rate limits and sort last in the intelligence preset (size_label tier).
      // Re-registering an existing model id re-binds it (model ids are unique
      // per platform, so one id can't live on two endpoints at once).
      db.prepare(`
        INSERT INTO models
          (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
           rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, key_id)
        VALUES ('custom', ?, ?, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1, ?)
        ON CONFLICT(platform, model_id)
        DO UPDATE SET display_name = excluded.display_name, key_id = excluded.key_id, enabled = 1
      `).run(modelId, displayName, keyId);

      const modelRow = db.prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = ?").get(modelId) as { id: number };

      // Append to the fallback chain if not already present.
      const inChain = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(modelRow.id);
      if (!inChain) {
        const max = db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config').get() as { m: number };
        db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(modelRow.id, max.m + 1);
      }

      registered.push({ modelDbId: modelRow.id, model: modelId, displayName });
    }

    return { keyId, registered, storedKeyForMask };
  });

  const { keyId, registered, storedKeyForMask } = upsert();
  // `model`/`displayName`/`modelDbId` echo the first model for older clients;
  // `models` carries the full set registered in this call.
  const first = registered[0]!;
  res.status(201).json({
    success: true,
    keyId,
    modelDbId: first.modelDbId,
    platform: 'custom',
    baseUrl,
    model: first.model,
    displayName: first.displayName,
    models: registered,
    accountName,
    accountEmail,
    externalId,
    options: parsed.data.options ?? {},
    maskedKey: maskKey(storedKeyForMask),
  });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT platform FROM api_keys WHERE id = ?').get(id) as { platform: string } | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    // Custom models exist only because POST /custom registered them alongside
    // their endpoint key (#117) — they can't route without it. Cascade away
    // the models bound to THIS endpoint (#212); other custom providers keep
    // theirs. Legacy rows (key_id NULL) are swept once no custom keys remain,
    // so they never linger in the fallback chain forever (#189).
    if (row.platform === 'custom') {
      const defaultEmbedding = db.prepare("SELECT value FROM settings WHERE key = 'embeddings_default_family'").get() as { value: string } | undefined;
      db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'custom' AND key_id = ?)").run(id);
      db.prepare("DELETE FROM models WHERE platform = 'custom' AND key_id = ?").run(id);
      db.prepare("DELETE FROM embedding_models WHERE platform = 'custom' AND key_id = ?").run(id);
      db.prepare("DELETE FROM media_models WHERE platform = 'custom' AND key_id = ?").run(id);
      const remaining = db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE platform = 'custom'").get() as { n: number };
      if (remaining.n === 0) {
        db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'custom')").run();
        db.prepare("DELETE FROM models WHERE platform = 'custom'").run();
        db.prepare("DELETE FROM embedding_models WHERE platform = 'custom'").run();
        db.prepare("DELETE FROM media_models WHERE platform = 'custom'").run();
      }
      if (defaultEmbedding) {
        const stillExists = db.prepare('SELECT 1 FROM embedding_models WHERE family = ? LIMIT 1').get(defaultEmbedding.value);
        if (!stillExists) {
          const replacement = db.prepare('SELECT family FROM embedding_models ORDER BY family, priority LIMIT 1').get() as { family: string } | undefined;
          if (replacement) {
            db.prepare("UPDATE settings SET value = ? WHERE key = 'embeddings_default_family'").run(replacement.family);
          }
        }
      }
    }
  });
  remove();
  scheduleHydrateSecretsToRemote(db);

  res.json({ success: true });
});

// Toggle all keys for a platform
keysRouter.patch('/platform/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as string;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({ error: { message: `Invalid platform '${platform}'` } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE platform = ?').run(enabled ? 1 : 0, platform);
  scheduleHydrateSecretsToRemote(db);

  res.json({ success: true, enabled, updatedKeys: result.changes });
});

// Update key (toggle enable/disable or edit label)
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const parsed = updateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { enabled, label, accountName, accountEmail, externalId, options } = parsed.data;
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }
  if (label !== undefined) {
    updates.push('label = ?');
    values.push(label);
  }
  if (accountName !== undefined) {
    updates.push('account_name = ?');
    values.push(accountName);
  }
  if (accountEmail !== undefined) {
    updates.push('account_email = ?');
    values.push(accountEmail);
  }
  if (externalId !== undefined) {
    updates.push('external_id = ?');
    values.push(externalId);
  }
  if (options !== undefined) {
    updates.push('options_json = ?');
    values.push(JSON.stringify(options));
  }

  values.push(id);

  const db = getDb();
  const result = db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  scheduleHydrateSecretsToRemote(db);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const response: Record<string, unknown> = { success: true };
  if (enabled !== undefined) response.enabled = enabled;
  if (label !== undefined) response.label = label;
  if (accountName !== undefined) response.accountName = accountName;
  if (accountEmail !== undefined) response.accountEmail = accountEmail;
  if (externalId !== undefined) response.externalId = externalId;
  if (options !== undefined) response.options = options;
  res.json(response);
});
