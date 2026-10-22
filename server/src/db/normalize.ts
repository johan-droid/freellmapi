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
    await ensurePrimaryKeySequences(db);
    await normalizeBooleanColumns(db);
    await normalizeLegacyModelsTable(db);
    await normalizeLegacyClientProfilesTable(db);
    await normalizeLegacyPlaygroundConversationsTable(db);
    await normalizeLegacyProviderQuotaTable(db);
    await recoverLegacyCredentials(db);
  } catch (err: any) {
    console.warn(`[db] note: legacy schema normalization check: ${err?.message ?? err}`);
  }
}

/**
 * Backward compatibility alias for normalizeLegacySchema.
 */
export const normalizeLegacyBooleanColumns = normalizeLegacySchema;

async function ensurePrimaryKeySequences(db: Db): Promise<void> {
  await db.exec(`
    DO $$
    DECLARE
      rec RECORD;
      seq_name text;
      max_val bigint;
    BEGIN
      -- 1. Attach sequence to any table that has a numeric 'id' column without a default / identity
      FOR rec IN (
        SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
         WHERE c.table_schema = current_schema()
           AND c.column_name = 'id'
           AND c.data_type IN ('bigint', 'integer', 'smallint')
           AND t.table_type = 'BASE TABLE'
           AND c.column_default IS NULL
           AND COALESCE(c.is_identity, 'NO') = 'NO'
      ) LOOP
        seq_name := rec.table_name || '_id_seq';
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
        EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', rec.table_name) INTO max_val;
        IF max_val = 0 THEN
          EXECUTE format('SELECT setval(%L, 1, false)', seq_name);
        ELSE
          EXECUTE format('SELECT setval(%L, %s, true)', seq_name, max_val);
        END IF;
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L)', rec.table_name, seq_name);
        BEGIN
          EXECUTE format('ALTER SEQUENCE %I OWNED BY %I.id', seq_name, rec.table_name);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;

      -- 2. Synchronize any existing serial / identity sequences to MAX(id)
      FOR rec IN (
        SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
         WHERE c.table_schema = current_schema()
           AND c.column_name = 'id'
           AND c.data_type IN ('bigint', 'integer', 'smallint')
           AND t.table_type = 'BASE TABLE'
      ) LOOP
        seq_name := pg_get_serial_sequence(rec.table_name, 'id');
        IF seq_name IS NOT NULL THEN
          EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', rec.table_name) INTO max_val;
          IF max_val > 0 THEN
            BEGIN
              EXECUTE format('SELECT setval(%L, %s, true)', seq_name, max_val);
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `);
}

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

async function normalizeLegacyPlaygroundConversationsTable(db: Db): Promise<void> {
  const tableExists = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'playground_conversations'
    ) AS exists
  `);
  if (!tableExists?.exists) return;

  const hasUpdatedAtMs = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'playground_conversations'
         AND column_name = 'updated_at_ms'
    ) AS exists
  `);

  if (!hasUpdatedAtMs?.exists) {
    console.log('[db] normalizing legacy playground_conversations table');
    const count = await db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM playground_conversations');
    if (!count || Number(count.cnt) === 0) {
      await db.exec('DROP TABLE playground_conversations;');
    } else {
      await db.exec(`
        ALTER TABLE playground_conversations
          ADD COLUMN IF NOT EXISTS messages_json TEXT NOT NULL DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS model TEXT,
          ADD COLUMN IF NOT EXISTS system_prompt TEXT,
          ADD COLUMN IF NOT EXISTS created_at_ms BIGINT,
          ADD COLUMN IF NOT EXISTS updated_at_ms BIGINT;
      `);

      const cols = await db.all<{ column_name: string }>(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'playground_conversations'
      `);
      const colSet = new Set(cols.map(c => c.column_name));

      if (colSet.has('messages')) {
        await db.exec(`
          UPDATE playground_conversations
             SET messages_json = messages::text
           WHERE (messages_json IS NULL OR messages_json = '[]') AND messages IS NOT NULL;
        `);
      }
      if (colSet.has('model_id')) {
        await db.exec(`
          UPDATE playground_conversations
             SET model = model_id
           WHERE model IS NULL AND model_id IS NOT NULL;
        `);
      }
      if (colSet.has('created_at')) {
        await db.exec(`
          UPDATE playground_conversations
             SET created_at_ms = (EXTRACT(EPOCH FROM created_at) * 1000)::bigint
           WHERE created_at_ms IS NULL AND created_at IS NOT NULL;
        `);
      }
      if (colSet.has('updated_at')) {
        await db.exec(`
          UPDATE playground_conversations
             SET updated_at_ms = (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint
           WHERE updated_at_ms IS NULL AND updated_at IS NOT NULL;
        `);
      }

      await db.exec(`
        UPDATE playground_conversations
           SET created_at_ms = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
         WHERE created_at_ms IS NULL;

        UPDATE playground_conversations
           SET updated_at_ms = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
         WHERE updated_at_ms IS NULL;

        ALTER TABLE playground_conversations
          ALTER COLUMN created_at_ms SET NOT NULL,
          ALTER COLUMN updated_at_ms SET NOT NULL;

        ALTER TABLE playground_conversations
          DROP COLUMN IF EXISTS messages,
          DROP COLUMN IF EXISTS model_id,
          DROP COLUMN IF EXISTS created_at,
          DROP COLUMN IF EXISTS updated_at;
      `);
    }
  }
}

async function normalizeLegacyProviderQuotaTable(db: Db): Promise<void> {
  const tableExists = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'provider_quota_observations'
    ) AS exists
  `);
  if (!tableExists?.exists) return;

  const cols = await db.all<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'provider_quota_observations'
  `);
  const colMap = new Map(cols.map(c => [c.column_name, c.data_type]));

  if (!colMap.has('created_at') || !colMap.has('raw_json') || !colMap.has('endpoint') || colMap.get('observed_at') !== 'text') {
    console.log('[db] normalizing legacy provider_quota_observations table');

    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_observations'
             AND column_name = 'raw_json'
        ) THEN
          ALTER TABLE provider_quota_observations ADD COLUMN raw_json TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_observations'
             AND column_name = 'endpoint'
        ) THEN
          ALTER TABLE provider_quota_observations ADD COLUMN endpoint TEXT;
        END IF;

        ALTER TABLE provider_quota_observations
          ALTER COLUMN limit_value TYPE DOUBLE PRECISION,
          ALTER COLUMN remaining_value TYPE DOUBLE PRECISION;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_observations'
             AND column_name = 'observed_at'
             AND data_type != 'text'
        ) THEN
          ALTER TABLE provider_quota_observations
            ALTER COLUMN observed_at DROP DEFAULT,
            ALTER COLUMN observed_at TYPE TEXT USING to_char(observed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
            ALTER COLUMN observed_at SET DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_observations'
             AND column_name = 'created_at'
        ) THEN
          ALTER TABLE provider_quota_observations
            ADD COLUMN created_at TEXT DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'));

          UPDATE provider_quota_observations
             SET created_at = observed_at
           WHERE created_at IS NULL AND observed_at IS NOT NULL;

          UPDATE provider_quota_observations
             SET created_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
           WHERE created_at IS NULL;

          ALTER TABLE provider_quota_observations
            ALTER COLUMN created_at SET NOT NULL;
        END IF;
      END $$;
    `);
  }

  const stateExists = await db.get<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'provider_quota_state'
    ) AS exists
  `);
  if (!stateExists?.exists) return;

  const stateCols = await db.all<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'provider_quota_state'
  `);
  const stateColMap = new Map(stateCols.map(c => [c.column_name, c.data_type]));

  if (stateColMap.get('observed_at') !== 'text' || stateColMap.get('updated_at') !== 'text') {
    console.log('[db] normalizing legacy provider_quota_state timestamps to TEXT');
    await db.exec(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_state'
             AND column_name = 'observed_at'
             AND data_type != 'text'
        ) THEN
          ALTER TABLE provider_quota_state
            ALTER COLUMN observed_at DROP DEFAULT,
            ALTER COLUMN observed_at TYPE TEXT USING to_char(observed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
            ALTER COLUMN observed_at SET DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'));
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'provider_quota_state'
             AND column_name = 'updated_at'
             AND data_type != 'text'
        ) THEN
          ALTER TABLE provider_quota_state
            ALTER COLUMN updated_at DROP DEFAULT,
            ALTER COLUMN updated_at TYPE TEXT USING to_char(updated_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
            ALTER COLUMN updated_at SET DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'));
        END IF;

        ALTER TABLE provider_quota_state
          ALTER COLUMN limit_value TYPE DOUBLE PRECISION,
          ALTER COLUMN remaining_value TYPE DOUBLE PRECISION;
      END $$;
    `);
  }
}

async function recoverLegacyCredentials(db: Db): Promise<void> {
  const canRecover = await db.get<{ exists: boolean }>(`
    SELECT (
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'credentials') AND
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'providers')
    ) AS exists
  `);

  if (!canRecover?.exists) return;

  const countBefore = await db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM api_keys').catch(() => null);

  await db.exec(`
    DO $$
    BEGIN
      -- Ensure api_keys table exists with baseline structure
      CREATE TABLE IF NOT EXISTS api_keys (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        platform TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        encrypted_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        enabled BIGINT NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')),
        last_checked_at TEXT
      );

      -- Ensure api_keys baseline columns and defaults exist
      ALTER TABLE api_keys
        ADD COLUMN IF NOT EXISTS platform TEXT,
        ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS encrypted_key TEXT,
        ADD COLUMN IF NOT EXISTS iv TEXT,
        ADD COLUMN IF NOT EXISTS auth_tag TEXT,
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS enabled BIGINT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')),
        ADD COLUMN IF NOT EXISTS last_checked_at TEXT;

      -- Ensure sequence on api_keys.id if column_default is missing
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'api_keys'
           AND column_name = 'id'
           AND column_default IS NULL
           AND COALESCE(is_identity, 'NO') = 'NO'
      ) THEN
        CREATE SEQUENCE IF NOT EXISTS api_keys_id_seq;
        PERFORM setval('api_keys_id_seq', COALESCE((SELECT MAX(id) FROM api_keys), 0) + 1, false);
        ALTER TABLE api_keys ALTER COLUMN id SET DEFAULT nextval('api_keys_id_seq');
        BEGIN
          ALTER SEQUENCE api_keys_id_seq OWNED BY api_keys.id;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;

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
       );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'legacy credential recovery: %', SQLERRM;
    END $$;
  `);

  const countAfter = await db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM api_keys').catch(() => null);
  if (countBefore && countAfter && Number(countAfter.cnt) > Number(countBefore.cnt)) {
    console.log(`[db] recovered ${Number(countAfter.cnt) - Number(countBefore.cnt)} legacy credentials into api_keys`);
  }
}


