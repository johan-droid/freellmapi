import { spawn, spawnSync } from 'child_process';
import type Database from 'better-sqlite3';
import { resolveDatabaseUrlEnv } from '../env.js';

type SecretSetting = { key: string; value: string };
type SecretKey = {
  id: number;
  platform: string;
  label: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
  created_at: string;
  last_checked_at: string | null;
  base_url: string | null;
};

type ProviderAccount = {
  id: string;
  provider_slug: string;
  display_name: string;
  account_email: string | null;
  encrypted_api_key: string;
  key_iv: string;
  key_auth_tag: string;
  key_hint: string | null;
  linked_api_key_id: number | null;
  status: string;
  base_url: string | null;
  created_at: string;
  updated_at: string;
};

type SecretSnapshot = {
  settings: SecretSetting[];
  apiKeys: SecretKey[];
  providerAccounts: ProviderAccount[];
};

let pendingPushSnapshot: SecretSnapshot | null = null;
let pushInFlight = false;

function runRemoteCommand(action: 'status' | 'pull' | 'push', payload?: SecretSnapshot): any {
  const databaseUrl = resolveDatabaseUrlEnv();
  if (!databaseUrl) {
    return null;
  }

  const script = `
    import { Pool } from 'pg';

    const action = process.argv[1];
    const env = process.env;
    const rawInput = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
    const input = rawInput ? JSON.parse(rawInput) : {};

    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === 'disable'
        ? undefined
        : { rejectUnauthorized: env.DATABASE_SSL === 'strict' },
    });

    async function ensureSchema() {
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      \`);
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY,
          platform TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          encrypted_key TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          last_checked_at TEXT,
          base_url TEXT
        )
      \`);
      await pool.query(\`
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
          created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        )
      \`);

      try {
        const checkConstraints = await pool.query(
          "SELECT conname FROM pg_constraint con INNER JOIN pg_class rel ON rel.oid = con.conrelid INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = 'public' AND rel.relname = 'api_keys' AND con.contype = 'c'"
        );
        for (const row of checkConstraints.rows) {
          await pool.query('ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS ' + row.conname);
        }
      } catch (e) {
        // ignore
      }

      try {
        const checkConstraintsPA = await pool.query(
          "SELECT conname FROM pg_constraint con INNER JOIN pg_class rel ON rel.oid = con.conrelid INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = 'public' AND rel.relname = 'provider_accounts' AND con.contype = 'c'"
        );
        for (const row of checkConstraintsPA.rows) {
          await pool.query('ALTER TABLE provider_accounts DROP CONSTRAINT IF EXISTS ' + row.conname);
        }
      } catch (e) {
        // ignore
      }
    }

    async function pull() {
      await ensureSchema();
      const [settings, apiKeys, providerAccounts] = await Promise.all([
        pool.query('SELECT key, value FROM settings ORDER BY key'),
        pool.query('SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url FROM api_keys ORDER BY id'),
        pool.query('SELECT id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at FROM provider_accounts ORDER BY id'),
      ]);
      console.log(JSON.stringify({ settings: settings.rows, apiKeys: apiKeys.rows, providerAccounts: providerAccounts.rows }));
    }

    async function push() {
      await ensureSchema();
      await pool.query('BEGIN');
      try {
        for (const row of input.settings ?? []) {
          await pool.query(\`
            INSERT INTO settings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          \`, [row.key, row.value]);
        }
        for (const row of input.apiKeys ?? []) {
          await pool.query(\`
            INSERT INTO api_keys
              (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
              platform = EXCLUDED.platform,
              label = EXCLUDED.label,
              encrypted_key = EXCLUDED.encrypted_key,
              iv = EXCLUDED.iv,
              auth_tag = EXCLUDED.auth_tag,
              status = EXCLUDED.status,
              enabled = EXCLUDED.enabled,
              created_at = EXCLUDED.created_at,
              last_checked_at = EXCLUDED.last_checked_at,
              base_url = EXCLUDED.base_url
          \`, [
            row.id, row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag,
            row.status, row.enabled, row.created_at, row.last_checked_at, row.base_url,
          ]);
        }
        for (const row of input.providerAccounts ?? []) {
          await pool.query(\`
            INSERT INTO provider_accounts
              (id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              provider_slug = EXCLUDED.provider_slug,
              display_name = EXCLUDED.display_name,
              account_email = EXCLUDED.account_email,
              encrypted_api_key = EXCLUDED.encrypted_api_key,
              key_iv = EXCLUDED.key_iv,
              key_auth_tag = EXCLUDED.key_auth_tag,
              key_hint = EXCLUDED.key_hint,
              linked_api_key_id = EXCLUDED.linked_api_key_id,
              status = EXCLUDED.status,
              base_url = EXCLUDED.base_url,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at
          \`, [
            row.id, row.provider_slug, row.display_name, row.account_email, row.encrypted_api_key,
            row.key_iv, row.key_auth_tag, row.key_hint, row.linked_api_key_id, row.status,
            row.base_url, row.created_at, row.updated_at,
          ]);
        }
        await pool.query('COMMIT');
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      } finally {
        await pool.end();
      }
    }

    async function status() {
      await ensureSchema();
      const [settings, apiKeys, providerAccounts] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM settings'),
        pool.query('SELECT COUNT(*)::int AS count FROM api_keys'),
        pool.query('SELECT COUNT(*)::int AS count FROM provider_accounts'),
      ]);
      console.log(JSON.stringify({
        settings: settings.rows[0].count,
        apiKeys: apiKeys.rows[0].count,
        providerAccounts: providerAccounts.rows[0].count
      }));
    }

    try {
      if (action === 'pull') await pull();
      else if (action === 'push') await push();
      else await status();
    } finally {
      if (action !== 'push') await pool.end().catch(() => {});
    }
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, action], {
    input: payload ? JSON.stringify(payload) : '',
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Remote secret sync failed (${action}): ${stderr || result.error?.message || 'unknown error'}`);
  }

  const stdout = result.stdout.trim();
  return stdout ? JSON.parse(stdout) : null;
}

async function runRemoteCommandAsync(action: 'status' | 'pull' | 'push', payload?: SecretSnapshot): Promise<any> {
  const databaseUrl = resolveDatabaseUrlEnv();
  if (!databaseUrl) {
    return null;
  }

  const script = `
    import { Pool } from 'pg';

    const action = process.argv[1];
    const env = process.env;
    const rawInput = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
    const input = rawInput ? JSON.parse(rawInput) : {};

    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === 'disable'
        ? undefined
        : { rejectUnauthorized: env.DATABASE_SSL === 'strict' },
    });

    async function ensureSchema() {
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      \`);
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY,
          platform TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          encrypted_key TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          last_checked_at TEXT,
          base_url TEXT
        )
      \`);
      await pool.query(\`
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
          created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
          updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        )
      \`);

      try {
        const checkConstraints = await pool.query(
          "SELECT conname FROM pg_constraint con INNER JOIN pg_class rel ON rel.oid = con.conrelid INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = 'public' AND rel.relname = 'api_keys' AND con.contype = 'c'"
        );
        for (const row of checkConstraints.rows) {
          await pool.query('ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS ' + row.conname);
        }
      } catch (e) {
        // ignore
      }

      try {
        const checkConstraintsPA = await pool.query(
          "SELECT conname FROM pg_constraint con INNER JOIN pg_class rel ON rel.oid = con.conrelid INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = 'public' AND rel.relname = 'provider_accounts' AND con.contype = 'c'"
        );
        for (const row of checkConstraintsPA.rows) {
          await pool.query('ALTER TABLE provider_accounts DROP CONSTRAINT IF EXISTS ' + row.conname);
        }
      } catch (e) {
        // ignore
      }
    }

    async function pull() {
      await ensureSchema();
      const [settings, apiKeys, providerAccounts] = await Promise.all([
        pool.query('SELECT key, value FROM settings ORDER BY key'),
        pool.query('SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url FROM api_keys ORDER BY id'),
        pool.query('SELECT id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at FROM provider_accounts ORDER BY id'),
      ]);
      console.log(JSON.stringify({ settings: settings.rows, apiKeys: apiKeys.rows, providerAccounts: providerAccounts.rows }));
    }

    async function push() {
      await ensureSchema();
      await pool.query('BEGIN');
      try {
        for (const row of input.settings ?? []) {
          await pool.query(\`
            INSERT INTO settings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          \`, [row.key, row.value]);
        }
        for (const row of input.apiKeys ?? []) {
          await pool.query(\`
            INSERT INTO api_keys
              (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
              platform = EXCLUDED.platform,
              label = EXCLUDED.label,
              encrypted_key = EXCLUDED.encrypted_key,
              iv = EXCLUDED.iv,
              auth_tag = EXCLUDED.auth_tag,
              status = EXCLUDED.status,
              enabled = EXCLUDED.enabled,
              created_at = EXCLUDED.created_at,
              last_checked_at = EXCLUDED.last_checked_at,
              base_url = EXCLUDED.base_url
          \`, [
            row.id, row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag,
            row.status, row.enabled, row.created_at, row.last_checked_at, row.base_url,
          ]);
        }
        for (const row of input.providerAccounts ?? []) {
          await pool.query(\`
            INSERT INTO provider_accounts
              (id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              provider_slug = EXCLUDED.provider_slug,
              display_name = EXCLUDED.display_name,
              account_email = EXCLUDED.account_email,
              encrypted_api_key = EXCLUDED.encrypted_api_key,
              key_iv = EXCLUDED.key_iv,
              key_auth_tag = EXCLUDED.key_auth_tag,
              key_hint = EXCLUDED.key_hint,
              linked_api_key_id = EXCLUDED.linked_api_key_id,
              status = EXCLUDED.status,
              base_url = EXCLUDED.base_url,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at
          \`, [
            row.id, row.provider_slug, row.display_name, row.account_email, row.encrypted_api_key,
            row.key_iv, row.key_auth_tag, row.key_hint, row.linked_api_key_id, row.status,
            row.base_url, row.created_at, row.updated_at,
          ]);
        }
        await pool.query('COMMIT');
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      } finally {
        await pool.end();
      }
    }

    async function status() {
      await ensureSchema();
      const [settings, apiKeys, providerAccounts] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM settings'),
        pool.query('SELECT COUNT(*)::int AS count FROM api_keys'),
        pool.query('SELECT COUNT(*)::int AS count FROM provider_accounts'),
      ]);
      console.log(JSON.stringify({
        settings: settings.rows[0].count,
        apiKeys: apiKeys.rows[0].count,
        providerAccounts: providerAccounts.rows[0].count
      }));
    }

    try {
      if (action === 'pull') await pull();
      else if (action === 'push') await push();
      else await status();
    } finally {
      if (action !== 'push') await pool.end().catch(() => {});
    }
  `;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script, action], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  if (payload) {
    child.stdin.write(JSON.stringify(payload));
  }
  child.stdin.end();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    throw new Error(`Remote secret sync failed (${action}): ${stderr.trim() || 'unknown error'}`);
  }

  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

export function hasRemoteSecretsStore(): boolean {
  return !!resolveDatabaseUrlEnv();
}

function readLocalSecretSnapshot(db: Database.Database): SecretSnapshot {
  const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as SecretSetting[];
  const apiKeys = db.prepare(`
    SELECT id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url
    FROM api_keys
    ORDER BY id
  `).all() as SecretKey[];
  const providerAccounts = db.prepare(`
    SELECT id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at
    FROM provider_accounts
    ORDER BY id
  `).all() as ProviderAccount[];
  return { settings, apiKeys, providerAccounts };
}

function upsertLocalSecrets(db: Database.Database, snapshot: SecretSnapshot): void {
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const upsertKey = db.prepare(`
    INSERT INTO api_keys
      (id, platform, label, encrypted_key, iv, auth_tag, status, enabled, created_at, last_checked_at, base_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      label = excluded.label,
      encrypted_key = excluded.encrypted_key,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      status = excluded.status,
      enabled = excluded.enabled,
      created_at = excluded.created_at,
      last_checked_at = excluded.last_checked_at,
      base_url = excluded.base_url
  `);
  const upsertProviderAccount = db.prepare(`
    INSERT INTO provider_accounts
      (id, provider_slug, display_name, account_email, encrypted_api_key, key_iv, key_auth_tag, key_hint, linked_api_key_id, status, base_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_slug = excluded.provider_slug,
      display_name = excluded.display_name,
      account_email = excluded.account_email,
      encrypted_api_key = excluded.encrypted_api_key,
      key_iv = excluded.key_iv,
      key_auth_tag = excluded.key_auth_tag,
      key_hint = excluded.key_hint,
      linked_api_key_id = excluded.linked_api_key_id,
      status = excluded.status,
      base_url = excluded.base_url,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

  const apply = db.transaction(() => {
    for (const row of snapshot.settings) {
      upsertSetting.run(row.key, row.value);
    }
    for (const row of snapshot.apiKeys) {
      upsertKey.run(
        row.id, row.platform, row.label, row.encrypted_key, row.iv, row.auth_tag,
        row.status, row.enabled, row.created_at, row.last_checked_at, row.base_url,
      );
    }
    for (const row of snapshot.providerAccounts ?? []) {
      upsertProviderAccount.run(
        row.id, row.provider_slug, row.display_name, row.account_email, row.encrypted_api_key,
        row.key_iv, row.key_auth_tag, row.key_hint, row.linked_api_key_id, row.status,
        row.base_url, row.created_at, row.updated_at,
      );
    }
  });
  apply();
}

export function hydrateSecretsFromRemote(db: Database.Database): boolean {
  if (!hasRemoteSecretsStore()) return false;
  const snapshot = runRemoteCommand('pull') as SecretSnapshot;
  upsertLocalSecrets(db, snapshot);
  return true;
}

export function hydrateSecretsToRemote(db: Database.Database): boolean {
  if (!hasRemoteSecretsStore()) return false;
  runRemoteCommand('push', readLocalSecretSnapshot(db));
  return true;
}

async function flushQueuedRemotePushes(): Promise<void> {
  if (pushInFlight || !pendingPushSnapshot) return;

  pushInFlight = true;
  try {
    while (pendingPushSnapshot) {
      const snapshot = pendingPushSnapshot;
      pendingPushSnapshot = null;
      await runRemoteCommandAsync('push', snapshot);
    }
  } catch (error) {
    console.warn(`[remote-secrets] Async push failed: ${(error as Error).message}`);
  } finally {
    pushInFlight = false;
    if (pendingPushSnapshot) {
      queueMicrotask(() => {
        void flushQueuedRemotePushes();
      });
    }
  }
}

export function scheduleHydrateSecretsToRemote(db: Database.Database): boolean {
  if (!hasRemoteSecretsStore()) return false;
  pendingPushSnapshot = readLocalSecretSnapshot(db);
  queueMicrotask(() => {
    void flushQueuedRemotePushes();
  });
  return true;
}

export function remoteSecretCounts(): { settings: number; apiKeys: number; providerAccounts: number } | null {
  if (!hasRemoteSecretsStore()) return null;
  return runRemoteCommand('status') as { settings: number; apiKeys: number; providerAccounts: number };
}
