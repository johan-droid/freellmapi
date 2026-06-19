import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some(row => row.name === column);
}

export function ensurePersistenceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_accounts (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      account_email TEXT,
      encrypted_api_key TEXT NOT NULL,
      key_iv TEXT NOT NULL,
      key_auth_tag TEXT NOT NULL,
      key_hint TEXT,
      linked_api_key_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      base_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_provider_accounts_slug ON provider_accounts(provider_slug);
    CREATE INDEX IF NOT EXISTS idx_provider_accounts_status ON provider_accounts(status);

    CREATE TABLE IF NOT EXISTS provider_catalog_models (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      context_window INTEGER,
      max_output_tokens INTEGER,
      supports_tools INTEGER NOT NULL DEFAULT 0,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      supports_streaming INTEGER NOT NULL DEFAULT 1,
      supports_json INTEGER NOT NULL DEFAULT 0,
      input_modalities TEXT,
      output_modalities TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_probe_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      removed_at TEXT,
      raw_metadata_json TEXT,
      UNIQUE(provider_slug, provider_model_id)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_catalog_slug_status ON provider_catalog_models(provider_slug, status);
    CREATE INDEX IF NOT EXISTS idx_provider_catalog_model ON provider_catalog_models(provider_model_id);

    CREATE TABLE IF NOT EXISTS provider_model_limits (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      rpm_limit INTEGER,
      rpd_limit INTEGER,
      tpm_limit INTEGER,
      tpd_limit INTEGER,
      concurrent_limit INTEGER,
      reset_window_seconds INTEGER,
      source TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_slug, provider_model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_usage_daily (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_account_id TEXT,
      provider_model_id TEXT,
      usage_date TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      failed_requests INTEGER NOT NULL DEFAULT 0,
      rate_limited_requests INTEGER NOT NULL DEFAULT 0,
      estimated_tpm INTEGER NOT NULL DEFAULT 0,
      estimated_tpd INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_slug, provider_account_id, provider_model_id, usage_date)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_usage_daily_date ON provider_usage_daily(usage_date);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_daily_provider ON provider_usage_daily(provider_slug, usage_date);

    CREATE TABLE IF NOT EXISTS provider_usage_minute (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_account_id TEXT,
      provider_model_id TEXT,
      minute_bucket TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_slug, provider_account_id, provider_model_id, minute_bucket)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_usage_minute_bucket ON provider_usage_minute(minute_bucket);
    CREATE INDEX IF NOT EXISTS idx_provider_usage_minute_provider ON provider_usage_minute(provider_slug, minute_bucket);

    CREATE TABLE IF NOT EXISTS provider_quota_state (
      platform TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      quota_pool_key TEXT NOT NULL,
      metric TEXT NOT NULL,
      limit_value INTEGER,
      remaining_value INTEGER,
      reset_at TEXT,
      reset_strategy TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'probe',
      confidence REAL NOT NULL DEFAULT 0,
      notes TEXT,
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, key_id, quota_pool_key, metric)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_quota_state_platform ON provider_quota_state(platform, key_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_provider_quota_state_reset_at ON provider_quota_state(reset_at);

    CREATE TABLE IF NOT EXISTS provider_quota_observations (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      provider_account_id TEXT,
      model_id TEXT,
      quota_pool_key TEXT NOT NULL,
      metric TEXT NOT NULL,
      status_code INTEGER,
      limit_value INTEGER,
      remaining_value INTEGER,
      reset_at TEXT,
      retry_after_ms INTEGER,
      reset_strategy TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'probe',
      confidence REAL NOT NULL DEFAULT 0,
      notes TEXT,
      raw_json TEXT,
      endpoint TEXT,
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_provider_quota_observations_platform ON provider_quota_observations(platform, key_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_provider_quota_observations_reset_at ON provider_quota_observations(reset_at);

    CREATE TABLE IF NOT EXISTS model_change_events (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_model_change_events_detected ON model_change_events(detected_at);
    CREATE INDEX IF NOT EXISTS idx_model_change_events_provider ON model_change_events(provider_slug, detected_at);

    CREATE TABLE IF NOT EXISTS model_probe_results (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      probe_type TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      ttfb_ms INTEGER,
      tokens_per_second REAL,
      error_code TEXT,
      error_message TEXT,
      observed_capabilities_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_model_probe_results_model ON model_probe_results(provider_slug, provider_model_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_probe_results_status ON model_probe_results(status, created_at);

    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      provider_slug TEXT,
      provider_account_id TEXT,
      provider_model_id TEXT,
      route_status TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider_slug, created_at);

    CREATE TABLE IF NOT EXISTS client_profiles (
      id TEXT PRIMARY KEY,
      client_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      detection_rules_json TEXT NOT NULL DEFAULT '{}',
      default_workload TEXT NOT NULL DEFAULT 'chat',
      routing_policy_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS request_sessions (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL UNIQUE,
      client_profile TEXT,
      workload TEXT NOT NULL DEFAULT 'chat',
      sticky_model_provider TEXT,
      sticky_model_id TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      request_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_request_sessions_client ON request_sessions(client_profile, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_request_sessions_workload ON request_sessions(workload, last_seen_at);

    CREATE TABLE IF NOT EXISTS model_workload_scores (
      id TEXT PRIMARY KEY,
      provider_slug TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      workload TEXT NOT NULL,
      reliability_score REAL NOT NULL DEFAULT 0,
      latency_score REAL NOT NULL DEFAULT 0,
      quality_score REAL NOT NULL DEFAULT 0,
      tool_score REAL NOT NULL DEFAULT 0,
      json_score REAL NOT NULL DEFAULT 0,
      headroom_score REAL NOT NULL DEFAULT 0,
      final_score REAL NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_slug, provider_model_id, workload)
    );

    CREATE INDEX IF NOT EXISTS idx_model_workload_scores_rank ON model_workload_scores(workload, final_score DESC);

    CREATE TABLE IF NOT EXISTS route_decisions (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      session_hash TEXT,
      client_profile TEXT,
      workload TEXT NOT NULL DEFAULT 'chat',
      selected_provider_slug TEXT,
      selected_model_id TEXT,
      candidate_models_json TEXT NOT NULL DEFAULT '[]',
      route_reason_json TEXT NOT NULL DEFAULT '{}',
      fallback_attempts INTEGER NOT NULL DEFAULT 0,
      raced_models_json TEXT NOT NULL DEFAULT '[]',
      winner_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_route_decisions_created ON route_decisions(created_at);
    CREATE INDEX IF NOT EXISTS idx_route_decisions_request ON route_decisions(request_id);
    CREATE INDEX IF NOT EXISTS idx_route_decisions_client_workload ON route_decisions(client_profile, workload, created_at);

    CREATE TABLE IF NOT EXISTS model_aliases (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL UNIQUE,
      description TEXT,
      workload TEXT,
      resolved_provider_slug TEXT,
      resolved_model_id TEXT,
      auto_update INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_model_aliases_workload ON model_aliases(workload);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Non-destructive compatibility migrations for databases created before this table grew.
  if (!hasColumn(db, 'provider_accounts', 'base_url')) {
    db.prepare('ALTER TABLE provider_accounts ADD COLUMN base_url TEXT').run();
  }
  if (!hasColumn(db, 'provider_accounts', 'linked_api_key_id')) {
    db.prepare('ALTER TABLE provider_accounts ADD COLUMN linked_api_key_id INTEGER').run();
  }
  if (!hasColumn(db, 'provider_catalog_models', 'last_seen_at')) {
    db.prepare('ALTER TABLE provider_catalog_models ADD COLUMN last_seen_at TEXT').run();
    db.prepare("UPDATE provider_catalog_models SET last_seen_at = COALESCE(updated_at, discovered_at, datetime('now')) WHERE last_seen_at IS NULL").run();
  }
  if (!hasColumn(db, 'provider_catalog_models', 'last_probe_at')) {
    db.prepare('ALTER TABLE provider_catalog_models ADD COLUMN last_probe_at TEXT').run();
  }

  seedClientProfiles(db);
}

function seedClientProfiles(db: Database.Database): void {
  const profiles = [
    {
      id: 'client_profile_claude_code',
      clientKey: 'claude-code',
      displayName: 'Claude Code',
      defaultWorkload: 'tool_agent',
      detectionRules: {
        paths: ['/v1/responses'],
        headers: ['x-api-key'],
        signals: ['responses_api', 'tools'],
      },
      routingPolicy: {
        prefer: ['tool_score', 'reliability_score', 'latency_score'],
        requireToolsWhenPresent: true,
        stickySessions: true,
      },
    },
    {
      id: 'client_profile_opencode',
      clientKey: 'opencode',
      displayName: 'OpenCode',
      defaultWorkload: 'code_agent',
      detectionRules: {
        signals: ['code_context', 'tools', 'streaming'],
      },
      routingPolicy: {
        prefer: ['latency_score', 'tool_score', 'quality_score'],
        stickySessions: true,
      },
    },
    {
      id: 'client_profile_lisa',
      clientKey: 'lisa',
      displayName: 'Lisa',
      defaultWorkload: 'assistant',
      detectionRules: {
        headers: ['x-freellmapi-client: lisa'],
      },
      routingPolicy: {
        prefer: ['quality_score', 'latency_score', 'headroom_score'],
        stickySessions: true,
      },
    },
    {
      id: 'client_profile_generic',
      clientKey: 'generic',
      displayName: 'Generic OpenAI-compatible Client',
      defaultWorkload: 'chat',
      detectionRules: {},
      routingPolicy: {
        prefer: ['latency_score', 'reliability_score', 'headroom_score'],
        stickySessions: false,
      },
    },
  ];

  const insert = db.prepare(`
    INSERT INTO client_profiles (
      id, client_key, display_name, detection_rules_json, default_workload, routing_policy_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_key) DO UPDATE SET
      display_name = excluded.display_name,
      detection_rules_json = excluded.detection_rules_json,
      default_workload = excluded.default_workload,
      routing_policy_json = excluded.routing_policy_json,
      updated_at = datetime('now')
  `);

  const apply = db.transaction(() => {
    for (const profile of profiles) {
      insert.run(
        profile.id,
        profile.clientKey,
        profile.displayName,
        JSON.stringify(profile.detectionRules),
        profile.defaultWorkload,
        JSON.stringify(profile.routingPolicy),
      );
    }
  });
  apply();
}
