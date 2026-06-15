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
}
