import type { Db } from './types.js';

/**
 * Pre-flight database normalization.
 *
 * In older iterations of the schema (such as the SQLite era, early forks, or
 * initial PostgreSQL migrations):
 * 1. Boolean flags (enabled, supports_vision, etc.) were native boolean instead of BIGINT.
 * 2. The `models` table in earlier fork iterations had `provider_id INTEGER NOT NULL REFERENCES providers(id)`,
 *    `canonical_name VARCHAR(128) NOT NULL`, and `UNIQUE(provider_id, model_id)` instead of
 *    `UNIQUE(platform, model_id)`.
 * 3. The `client_profiles` table in earlier fork iterations had `api_key` without `token_hash`,
 *    `encrypted_key`, `iv`, `auth_tag`.
 * 4. Stored credentials in `credentials` table (from older forks) may need to be recovered into `api_keys`.
 *
 * This function detects these legacy patterns in the active database schema and safely
 * normalizes them so all migrations (starting with 20260101_000000_legacy_baseline.ts)
 * can run cleanly and idempotently.
 */
export async function normalizeLegacySchema(db: Db): Promise<void> {
  try {
    await normalizeBooleanColumns(db);
    await normalizeLegacyModelsTable(db);
    await normalizeLegacyClientProfilesTable(db);
    await recoverLegacyCredentials(db);
  } catch (err: any) {
    console.warn(`[db] note: legacy schema normalization check: ${err?.message ?? err}`);
  }
}

/**
 * Backward compatibility alias for normalizeLegacySchema.
 */
export const normalizeLegacyBooleanColumns = normalizeLegacySchema;

async function normalizeBooleanColumns(db: Db): Promise<void> {
  const rows = await db.all<{
    table_name: string;
    column_name: string;
    column_default: string | null;
  }>(`
    SELECT table_name, column_name, column_default
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND data_type = 'boolean'
  `);

  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    const { table_name, column_name, column_default } = row;

    const hasTrueDefault = column_default ? /true|1/i.test(column_default) : false;
    const defaultVal = (
      hasTrueDefault ||
      column_name === 'enabled' ||
      column_name === 'supports_streaming' ||
      column_name === 'auto_include_new_models'
    ) ? 1 : 0;

    console.log(`[db] normalizing legacy boolean column ${table_name}.${column_name} to BIGINT (default ${defaultVal})`);

    await db.exec(`
      ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" DROP DEFAULT;
      ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE BIGINT USING (
        CASE
          WHEN "${column_name}" IS TRUE THEN 1
          WHEN "${column_name}" IS FALSE THEN 0
          ELSE NULL
        END
      );
      ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" SET DEFAULT ${defaultVal};
    `);
  }
}

async function normalizeLegacyModelsTable(db: Db): Promise<void> {
  const tableExists = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'models'
    ) AS exists
  `);
  if (!tableExists?.exists) return;

  const modelCols = await db.all<{ column_name: string; is_nullable: string }>(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'models'
  `);
  const colNames = new Set(modelCols.map(c => c.column_name));

  if (colNames.has('provider_id') || colNames.has('canonical_name')) {
    console.log('[db] normalizing legacy models table: resolving provider_id / canonical_name');

    // If platform is missing or has NULLs, backfill from providers table if available
    if (colNames.has('platform')) {
      const hasProviders = await db.get<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name = 'providers'
        ) AS exists
      `);
      if (hasProviders?.exists && colNames.has('provider_id')) {
        await db.exec(`
          UPDATE models m
             SET platform = p.provider_key
            FROM providers p
           WHERE m.provider_id = p.id
             AND (m.platform IS NULL OR m.platform = '');
        `);
      }
    } else {
      await db.exec('ALTER TABLE models ADD COLUMN platform TEXT;');
      const hasProviders = await db.get<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name = 'providers'
        ) AS exists
      `);
      if (hasProviders?.exists && colNames.has('provider_id')) {
        await db.exec(`
          UPDATE models m
             SET platform = p.provider_key
            FROM providers p
           WHERE m.provider_id = p.id;
        `);
      }
    }

    // Delete any rows that still have no platform
    await db.exec("DELETE FROM models WHERE platform IS NULL OR platform = '';");

    // Drop all foreign key constraints defined on models table (e.g. models_provider_id_fkey, models_key_id_fkey)
    await db.exec(`
      DO $$
      DECLARE
        fk_record RECORD;
      BEGIN
        FOR fk_record IN (
          SELECT conname
            FROM pg_constraint
           WHERE conrelid = 'models'::regclass
             AND contype = 'f'
        ) LOOP
          EXECUTE 'ALTER TABLE models DROP CONSTRAINT ' || quote_ident(fk_record.conname);
        END LOOP;
      END $$;
    `);

    // Drop any unique constraints on models that reference provider_id
    await db.exec(`
      DO $$
      DECLARE
        uq_record RECORD;
      BEGIN
        FOR uq_record IN (
          SELECT conname
            FROM pg_constraint
           WHERE conrelid = 'models'::regclass
             AND contype = 'u'
             AND pg_get_constraintdef(oid) LIKE '%provider_id%'
        ) LOOP
          EXECUTE 'ALTER TABLE models DROP CONSTRAINT ' || quote_ident(uq_record.conname);
        END LOOP;
      END $$;
    `);

    // Drop provider_id and canonical_name columns
    await db.exec(`
      ALTER TABLE models DROP COLUMN IF EXISTS provider_id CASCADE;
      ALTER TABLE models DROP COLUMN IF EXISTS canonical_name CASCADE;
    `);
  }

  // Ensure all standard baseline columns exist with correct types and defaults
  await db.exec(`
    ALTER TABLE models
      ADD COLUMN IF NOT EXISTS platform TEXT,
      ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS intelligence_rank BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS speed_rank BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS size_label TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS rpm_limit BIGINT,
      ADD COLUMN IF NOT EXISTS rpd_limit BIGINT,
      ADD COLUMN IF NOT EXISTS tpm_limit BIGINT,
      ADD COLUMN IF NOT EXISTS tpd_limit BIGINT,
      ADD COLUMN IF NOT EXISTS monthly_token_budget TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS context_window BIGINT,
      ADD COLUMN IF NOT EXISTS enabled BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS supports_vision BIGINT NOT NULL DEFAULT 0;
  `);

  // Ensure platform is NOT NULL
  const updatedCols = await db.all<{ column_name: string; is_nullable: string }>(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'models'
  `);
  const platformCol = updatedCols.find(c => c.column_name === 'platform');
  if (platformCol && platformCol.is_nullable === 'YES') {
    await db.exec(`
      DELETE FROM models WHERE platform IS NULL OR platform = '';
      ALTER TABLE models ALTER COLUMN platform SET NOT NULL;
    `);
  }

  // Deduplicate and ensure UNIQUE(platform, model_id)
  await db.exec(`
    DELETE FROM models a USING models b
     WHERE a.id < b.id
       AND a.platform = b.platform
       AND a.model_id = b.model_id;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_models_platform_model_id ON models (platform, model_id);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'models'::regclass
           AND contype = 'u'
           AND pg_get_constraintdef(oid) LIKE '%(platform, model_id)%'
      ) THEN
        ALTER TABLE models ADD CONSTRAINT uq_models_platform_model_id UNIQUE (platform, model_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `);

  // Ensure default values on required models columns
  await db.exec(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'intelligence_rank') THEN
        ALTER TABLE models ALTER COLUMN intelligence_rank SET DEFAULT 0;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'speed_rank') THEN
        ALTER TABLE models ALTER COLUMN speed_rank SET DEFAULT 0;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'size_label') THEN
        ALTER TABLE models ALTER COLUMN size_label SET DEFAULT '';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'monthly_token_budget') THEN
        ALTER TABLE models ALTER COLUMN monthly_token_budget SET DEFAULT '';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'enabled') THEN
        ALTER TABLE models ALTER COLUMN enabled SET DEFAULT 1;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'models' AND column_name = 'supports_vision') THEN
        ALTER TABLE models ALTER COLUMN supports_vision SET DEFAULT 0;
      END IF;
    END $$;
  `);

  // Align primary key sequence if needed
  await db.exec(`
    DO $$
    DECLARE
      seq_name text;
    BEGIN
      seq_name := pg_get_serial_sequence('models', 'id');
      IF seq_name IS NOT NULL THEN
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM models), 1))', seq_name);
      END IF;
    END $$;
  `);
}

async function normalizeLegacyClientProfilesTable(db: Db): Promise<void> {
  const tableExists = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'client_profiles'
    ) AS exists
  `);
  if (!tableExists?.exists) return;

  const hasTokenHash = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'client_profiles'
         AND column_name = 'token_hash'
    ) AS exists
  `);

  if (!hasTokenHash?.exists) {
    console.log('[db] normalizing legacy client_profiles table');
    const count = await db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM client_profiles');
    if (!count || Number(count.cnt) === 0) {
      await db.exec('DROP TABLE client_profiles;');
    } else {
      await db.exec(`
        ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS token_hash TEXT;
        ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
        ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS iv TEXT;
        ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS auth_tag TEXT;
      `);
      const hasApiKey = await db.get<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'client_profiles'
             AND column_name = 'api_key'
        ) AS exists
      `);
      if (hasApiKey?.exists) {
        await db.exec(`
          UPDATE client_profiles
             SET token_hash = encode(sha256(api_key::bytea), 'hex')
           WHERE token_hash IS NULL AND api_key IS NOT NULL;
        `);
      }
    }
  }
}

async function recoverLegacyCredentials(db: Db): Promise<void> {
  const canRecover = await db.get<{ exists: boolean }>(`
    SELECT (
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'credentials') AND
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'providers') AND
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'api_keys')
    ) AS exists
  `);

  if (!canRecover?.exists) return;

  try {
    const res = await db.run(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, enabled, status, created_at)
      SELECT p.provider_key,
             COALESCE(c.credential_name, ''),
             c.encrypted_value,
             c.iv,
             c.auth_tag,
             CASE WHEN c.enabled::text = 'true' OR c.enabled::text = '1' THEN 1 ELSE 0 END,
             'unknown',
             to_char(COALESCE(c.created_at, NOW()), 'YYYY-MM-DD HH24:MI:SS')
        FROM credentials c
        JOIN providers p ON c.provider_id = p.id
       WHERE NOT EXISTS (
         SELECT 1 FROM api_keys a
          WHERE a.encrypted_key = c.encrypted_value
            AND a.iv = c.iv
       )
    `);
    if (res && res.changes && res.changes > 0) {
      console.log(`[db] recovered ${res.changes} legacy credentials into api_keys`);
    }
  } catch (err: any) {
    console.warn(`[db] note: legacy credential recovery: ${err?.message ?? err}`);
  }
}

