import type { Db } from '../types.js';
import { applyModelPricing } from '../model-pricing.js';
import { refreshModelIntentFlags } from '../../services/model-intent.js';

export function up(db: Db): void {
  const insertModel = db.prepare(`
    INSERT OR IGNORE INTO models (
      platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
      rpm_limit, rpd_limit, tpm_limit, tpd_limit, context_window, enabled,
      supports_vision, supports_tools, coding_bias, research_bias, chat_bias
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);

  const modelsToSeed = [
    ['friendli', 'meta-llama/Llama-3.3-70B-Instruct', 'Friendli Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['featherless', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'Featherless Llama 3.1 8B', 4, 5, '8B', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['baseten', 'meta-llama/Llama-3.3-70B-Instruct', 'Baseten Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['deepinfra', 'meta-llama/Llama-3.3-70B-Instruct', 'DeepInfra Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['ai21', 'jamba-1.5-mini', 'AI21 Jamba 1.5 Mini', 4, 5, '12B', 60, 1000, 100000, 1000000, 256000, 0, 1, 1, 0, 1],
    ['fireworks', 'accounts/fireworks/models/llama-v3p3-70b-instruct', 'Fireworks Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Together Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['replicate', 'meta/meta-llama-3-70b-instruct', 'Replicate Llama 3 70B', 5, 4, '70B', 60, 1000, 100000, 1000000, 8192, 0, 1, 1, 0, 1],
    ['modelscope', 'Qwen/Qwen2.5-72B-Instruct', 'ModelScope Qwen 2.5 72B', 5, 5, '72B', 60, 2000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['qianfan', 'ernie-speed-128k', 'Qianfan ERNIE Speed 128K', 4, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 0, 0, 1],
    ['volcengine', 'doubao-1.5-pro-32k', 'Volcengine Doubao 1.5 Pro', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 32000, 0, 1, 1, 0, 1],
    ['longcat', 'longcat-chat', 'LongCat Chat', 4, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 0, 0, 1],
    ['xfyun', 'lite', 'iFlytek Spark Lite', 3, 5, 'Lite', 60, 1000, 100000, 1000000, 32000, 0, 0, 0, 0, 1],
    ['aihorde', 'llama-3-8b-instruct', 'AI Horde Llama 3 8B', 3, 4, '8B', 30, 500, 50000, 500000, 8192, 0, 0, 0, 0, 1],
  ];

  for (const m of modelsToSeed) {
    insertModel.run(...m);
  }

  const expansionPlatforms = [
    'friendli', 'featherless', 'baseten', 'deepinfra', 'ai21', 'fireworks',
    'together', 'replicate', 'modelscope', 'qianfan', 'volcengine', 'longcat',
    'xfyun', 'aihorde'
  ];
  const expansionPlaceholders = expansionPlatforms.map(() => '?').join(',');

  // Ensure every newly seeded expansion model has a fallback_config row
  db.prepare(`
    INSERT OR IGNORE INTO fallback_config (model_db_id, priority, enabled)
    SELECT m.id, 999, 1
      FROM models m
      LEFT JOIN fallback_config f ON f.model_db_id = m.id
     WHERE f.id IS NULL
       AND m.platform IN (${expansionPlaceholders})
  `).run(...expansionPlatforms);

  // Update intent flags & pricing
  refreshModelIntentFlags(db);
  applyModelPricing(db);

  db.prepare("DELETE FROM settings WHERE key = 'provider_models_expansion_downgraded'").run();

  // Backfill newly seeded expansion models into active profiles
  const profiles = db.prepare('SELECT id FROM profiles').all() as { id: number }[];
  const insertProfileModel = db.prepare('INSERT OR IGNORE INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, ?, 1)');

  for (const p of profiles) {
    const unmapped = db.prepare(`
      SELECT m.id FROM models m
      WHERE m.platform IN (${expansionPlaceholders})
        AND m.id NOT IN (SELECT model_db_id FROM profile_models WHERE profile_id = ?)
    `).all(...expansionPlatforms, p.id) as { id: number }[];

    for (let i = 0; i < unmapped.length; i++) {
      insertProfileModel.run(p.id, unmapped[i].id, 999 + i);
    }
  }
}

export function down(db: Db): void {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES ('provider_models_expansion_downgraded', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}
