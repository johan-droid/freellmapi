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
    // Batch 1 Core Inference
    ['hyperbolic', 'meta-llama/Llama-3.3-70B-Instruct', 'Hyperbolic Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['lambda', 'hermes-3-llama-3.1-405b', 'Lambda Hermes 3 405B', 5, 4, '405B', 60, 1000, 100000, 1000000, 128000, 0, 0, 1, 1, 1],
    ['nebius', 'meta-llama/Llama-3.3-70B-Instruct', 'Nebius Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['nscale', 'meta-llama/Llama-3.3-70B-Instruct', 'nScale Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['nous', 'hermes-3-llama-3.1-70b', 'Nous Hermes 3 70B', 5, 4, '70B', 60, 1000, 100000, 1000000, 128000, 0, 0, 1, 1, 1],
    ['llama_api', 'llama-3.3-70b-instruct', 'Meta Llama 3.3 70B', 5, 5, 'Medium', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['perplexity', 'sonar-pro', 'Perplexity Sonar Pro', 5, 4, 'Frontier', 60, 1000, 100000, 1000000, 128000, 0, 0, 0, 1, 1],
    ['xai', 'grok-2-latest', 'xAI Grok 2', 5, 5, 'Frontier', 60, 1000, 100000, 1000000, 128000, 1, 1, 1, 1, 1],
    ['liquid', 'liquid-lfm-40b', 'Liquid LFM 40B', 4, 5, '40B', 60, 1000, 100000, 1000000, 64000, 0, 1, 1, 0, 1],
    ['upstage', 'solar-pro', 'Upstage Solar Pro', 4, 5, '22B', 60, 1000, 100000, 1000000, 32000, 0, 1, 1, 0, 1],
    ['morph', 'morph-v1-fast', 'Morph Fast 70B', 4, 5, '70B', 60, 1000, 100000, 1000000, 64000, 0, 1, 1, 0, 1],

    // Cloud Providers
    ['aws_bedrock', 'anthropic.claude-3-5-sonnet-20241022-v2:0', 'AWS Bedrock Claude 3.5 Sonnet', 5, 5, 'Frontier', 100, 5000, 200000, 5000000, 200000, 1, 1, 1, 1, 1],
    ['google_vertex', 'gemini-1.5-pro', 'Google Vertex Gemini 1.5 Pro', 5, 5, 'Frontier', 100, 5000, 200000, 5000000, 1000000, 1, 1, 1, 1, 1],
    ['azure', 'gpt-4o', 'Azure OpenAI GPT-4o', 5, 5, 'Frontier', 100, 5000, 200000, 5000000, 128000, 1, 1, 1, 1, 1],
    ['watsonx', 'ibm/granite-3-8b-instruct', 'IBM watsonx Granite 3 8B', 4, 4, '8B', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],
    ['scaleway', 'qwen2.5-coder-32b-instruct', 'Scaleway Qwen 2.5 Coder 32B', 5, 5, '32B', 60, 1000, 100000, 1000000, 128000, 0, 1, 1, 0, 1],

    // Local Self-Hosted Providers
    ['ollama_local', 'llama3:latest', 'Ollama Local Llama 3', 4, 5, '8B', null, null, null, null, 128000, 0, 1, 1, 0, 1],
    ['lmstudio', 'qwen2.5-coder-7b', 'LM Studio Local Qwen 2.5 Coder', 4, 5, '7B', null, null, null, null, 128000, 0, 1, 1, 0, 1],
    ['llamacpp', 'llama-3.2-3b-instruct', 'llama.cpp Local Llama 3.2 3B', 3, 5, '3B', null, null, null, null, 64000, 0, 1, 0, 0, 1],
    ['vllm', 'meta-llama/Llama-3.3-70B-Instruct', 'vLLM Local Llama 3.3 70B', 5, 5, 'Medium', null, null, null, null, 128000, 0, 1, 1, 0, 1],
  ];

  for (const m of modelsToSeed) {
    insertModel.run(...m);
  }

  const expansionPlatforms = [
    'hyperbolic', 'lambda', 'nebius', 'nscale', 'nous', 'llama_api',
    'perplexity', 'xai', 'liquid', 'upstage', 'morph',
    'aws_bedrock', 'google_vertex', 'azure', 'watsonx', 'scaleway',
    'ollama_local', 'lmstudio', 'llamacpp', 'vllm'
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

  db.prepare("DELETE FROM settings WHERE key = 'provider_ecosystem_expansion_downgraded'").run();

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
    VALUES ('provider_ecosystem_expansion_downgraded', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}
