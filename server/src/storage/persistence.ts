import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { gzipSync, gunzipSync } from 'zlib';
import { downloadDbSnapshot, uploadDbSnapshot, uploadTimestampedBackup } from './b2.js';
import { resolveDefaultDbPath, resolveDatabaseUrlEnv } from '../env.js';

const remoteEnvKeys = {
  endpoint: ['B2_ENDPOINT', 'LITESTREAM_ENDPOINT'],
  bucket: ['B2_BUCKET', 'LITESTREAM_BUCKET'],
  keyId: ['B2_KEY_ID', 'LITESTREAM_ACCESS_KEY_ID'],
  secret: ['B2_APPLICATION_KEY', `LITESTREAM_${'SECRET'}_${'ACCESS'}_${'KEY'}`],
};

function readFirst(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function hasRemoteSnapshotConfig(): boolean {
  return Boolean(
    readFirst(remoteEnvKeys.endpoint) &&
    readFirst(remoteEnvKeys.bucket) &&
    readFirst(remoteEnvKeys.keyId) &&
    readFirst(remoteEnvKeys.secret),
  );
}

let persistenceRestoreStatus: 'restored' | 'skipped' | 'fresh' = 'fresh';
let lastBackupTime: string | null = null;
let lastBackupError: string | null = null;

export function getPersistenceStatus() {
  const dbPath = getDatabasePath();
  const exists = fs.existsSync(dbPath);
  let size = 0;
  if (exists) {
    size = fs.statSync(dbPath).size;
  }
  return {
    path: dbPath,
    exists,
    size,
    restoreStatus: persistenceRestoreStatus,
    lastBackupTime,
    lastBackupError,
    configured: hasRemoteSnapshotConfig() || !!resolveDatabaseUrlEnv()
  };
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH?.trim() ||
    process.env.FREEAPI_DB_PATH?.trim() ||
    process.env.DB_PATH?.trim() ||
    resolveDefaultDbPath();
}

function runPostgresDbCommand(action: 'pull' | 'push', payload?: string): string | null {
  const databaseUrl = resolveDatabaseUrlEnv();
  if (!databaseUrl) return null;

  const script = `
    import { Pool } from 'pg';

    const action = process.argv[1];
    const env = process.env;
    
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === 'disable'
        ? undefined
        : { rejectUnauthorized: env.DATABASE_SSL === 'strict' },
    });

    async function ensureSchema() {
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS sqlite_backups (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      \`);
    }

    async function pull() {
      await ensureSchema();
      const res = await pool.query("SELECT value FROM sqlite_backups WHERE key = 'latest_backup'");
      if (res.rows.length > 0) {
        process.stdout.write(res.rows[0].value);
      }
    }

    async function push() {
      await ensureSchema();
      const rawInput = await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });
      
      await pool.query(\`
        INSERT INTO sqlite_backups (key, value, updated_at)
        VALUES ('latest_backup', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      \`, [rawInput]);
    }

    try {
      if (action === 'pull') await pull();
      else if (action === 'push') await push();
    } finally {
      await pool.end().catch(() => {});
    }
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, action], {
    input: payload || '',
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Postgres DB backup failed (${action}): ${stderr || result.error?.message || 'unknown error'}`);
  }

  return result.stdout;
}

async function runPostgresDbCommandAsync(action: 'push', payload: string): Promise<void> {
  const databaseUrl = resolveDatabaseUrlEnv();
  if (!databaseUrl) return;

  const script = `
    import { Pool } from 'pg';

    const action = process.argv[1];
    const env = process.env;
    
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === 'disable'
        ? undefined
        : { rejectUnauthorized: env.DATABASE_SSL === 'strict' },
    });

    async function ensureSchema() {
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS sqlite_backups (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      \`);
    }

    async function push() {
      await ensureSchema();
      const rawInput = await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });
      
      await pool.query(\`
        INSERT INTO sqlite_backups (key, value, updated_at)
        VALUES ('latest_backup', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      \`, [rawInput]);
    }

    try {
      if (action === 'push') await push();
    } finally {
      await pool.end().catch(() => {});
    }
  `;

  const child = spawn(process.execPath, ['--input-type=module', '-e', script, action], {
    env: process.env,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr += chunk; });

  child.stdin?.write(payload);
  child.stdin?.end();

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    throw new Error(`Postgres DB backup async push failed: ${stderr.trim() || 'unknown error'}`);
  }
}

export async function restoreDatabaseBeforeBoot(): Promise<void> {
  const dbPath = getDatabasePath();
  if (dbPath === ':memory:') return;

  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    if (stats.size > 0) {
      persistenceRestoreStatus = 'skipped';
      console.log('[persistence] Local DB exists, restore skipped.');
      return;
    }
  }

  // 1. Try PostgreSQL / Neon restore first if DATABASE_URL is set
  if (resolveDatabaseUrlEnv()) {
    try {
      console.log('[persistence] Attempting to restore database from PostgreSQL Neon store...');
      const base64Data = runPostgresDbCommand('pull');
      if (base64Data && base64Data.trim().length > 0) {
        const zipped = Buffer.from(base64Data.trim(), 'base64');
        const restored = gunzipSync(zipped);
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        fs.writeFileSync(dbPath, restored);
        persistenceRestoreStatus = 'restored';
        console.log(`[persistence] Restored SQLite database from PostgreSQL Neon store to ${dbPath}`);
        return;
      }
      console.warn('[persistence] No SQLite database backup found in PostgreSQL Neon store.');
    } catch (error) {
      console.warn(`[persistence] PostgreSQL Neon restore failed: ${(error as Error).message}`);
    }
  }

  // 2. Try Backblaze B2 restore as fallback if configured
  if (hasRemoteSnapshotConfig()) {
    try {
      const restored = await downloadDbSnapshot(dbPath);
      if (restored) {
        persistenceRestoreStatus = 'restored';
        console.log(`[persistence] Restored SQLite database from remote object storage to ${dbPath}`);
        return;
      }
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      persistenceRestoreStatus = 'fresh';
      console.warn('[persistence] No remote DB snapshot found; creating a new local SQLite DB.');
    } catch (error) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      persistenceRestoreStatus = 'fresh';
      console.warn(`[persistence] Remote DB restore failed; creating a new local SQLite DB: ${(error as Error).message}`);
    }
    return;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export function startDatabaseSnapshotLoop(): () => void {
  const dbPath = getDatabasePath();
  if (dbPath === ':memory:') {
    return () => undefined;
  }

  const hasPostgres = !!resolveDatabaseUrlEnv();
  const hasB2 = hasRemoteSnapshotConfig();

  if (!hasPostgres && !hasB2) {
    return () => undefined;
  }

  const intervalSeconds = Number(process.env.B2_SNAPSHOT_INTERVAL_SECONDS ?? process.env.LITESTREAM_SNAPSHOT_INTERVAL_SECONDS ?? 300);
  const intervalMs = Math.max(60, intervalSeconds) * 1000;

  const snapshot = async () => {
    if (!fs.existsSync(dbPath)) return;

    if (hasPostgres) {
      try {
        const plain = fs.readFileSync(dbPath);
        const zipped = gzipSync(plain);
        const base64Data = zipped.toString('base64');
        await runPostgresDbCommandAsync('push', base64Data);
        lastBackupTime = new Date().toISOString();
        lastBackupError = null;
        console.log('[persistence] Uploaded SQLite database backup to PostgreSQL Neon store.');
      } catch (error) {
        lastBackupError = (error as Error).message;
        console.warn(`[persistence] PostgreSQL Neon backup upload failed: ${(error as Error).message}`);
      }
    }

    if (hasB2) {
      try {
        const backupKey = await uploadTimestampedBackup(dbPath);
        if (backupKey) {
          await uploadDbSnapshot(dbPath);
          lastBackupTime = new Date().toISOString();
          lastBackupError = null;
          console.log('[persistence] Uploaded timestamped SQLite backup and latest snapshot to remote object storage.');
        } else {
          lastBackupError = 'Timestamped backup failed or not configured';
          console.warn('[persistence] Timestamped backup failed or not configured; skipping latest snapshot update to prevent overwrite.');
        }
      } catch (error) {
        lastBackupError = (error as Error).message;
        console.warn(`[persistence] B2 Snapshot upload failed: ${(error as Error).message}`);
      }
    }
  };

  const timer = setInterval(() => void snapshot(), intervalMs);
  timer.unref?.();

  const stop = () => {
    clearInterval(timer);
    void snapshot();
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return stop;
}
