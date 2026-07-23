import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { resolveDefaultDbPath } from '../env.js';
import { runMigrationsSync } from './migrate/runner.js';
import { initEncryptionKey, isEncryptionKeyInitialized, encrypt, decrypt } from '../lib/crypto.js';
import { scheduleHydrateSecretsToRemote } from '../services/remote-secrets.js';
import { nodeSqliteFactory } from './node-sqlite.js';
import type { Db, DbFactory } from './types.js';

export type { Db, DbFactory } from './types.js';

const DB_PATH = resolveDefaultDbPath();
const runtimeRequire = createRequire(import.meta.url);

let db: Db;

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() or connectDb() first.');
  }
  return db;
}

export function getDefaultDbPath(): string {
  return process.env.FREEAPI_DB_PATH?.trim() || DB_PATH;
}

/** Default factory: opens a better-sqlite3 connection at the given path. */
function betterSqliteFactory(resolvedPath: string): Db {
  let BetterSqlite: new (path: string) => unknown;
  try {
    BetterSqlite = runtimeRequire('better-sqlite3') as new (path: string) => unknown;
  } catch (cause) {
    throw new Error(
      'better-sqlite3 is not installed. Reinstall dependencies, or use Node.js 22.13+ on Android/Termux.',
      { cause },
    );
  }
  return new BetterSqlite(resolvedPath) as Db;
}

export function defaultDbFactory(platform: NodeJS.Platform = process.platform): DbFactory {
  return platform === 'android' ? nodeSqliteFactory : betterSqliteFactory;
}

export function connectDb(
  dbPath?: string,
  opts?: {
    /** Create the parent directory if absent. Default: true. Set false in
     *  environments that do not have a writable local filesystem. */
    ensureDir?: boolean;
    /** Factory that constructs the raw Db connection. Default: better-sqlite3. */
    factory?: DbFactory;
  },
): Db {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  const isMemory = resolvedPath === ':memory:';
  const ensureDir = opts?.ensureDir ?? true;
  const factory = opts?.factory ?? defaultDbFactory();

  if (!isMemory && ensureDir) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = factory(resolvedPath);
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log(`Database initialized at ${resolvedPath}`);
  return db;
}

export function initDb(
  dbPath?: string,
  opts?: { ensureDir?: boolean; factory?: DbFactory },
): Db {
  const db = connectDb(dbPath, opts);

  if (process.env.NODE_ENV !== 'development') {
    runMigrationsSync(db, 'up');
  } else {
    // In dev, verify the DB has been initialised. If not, give a clear error.
    const ready = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
    ).get();
    if (!ready) {
      console.error(
        '\n  [dev] Database not initialised. Run:\n\n' +
        '    npm run db:migration:up\n\n' +
        '  Then restart the server.\n'
      );
      process.exit(1);
    }
  }

  if (!isEncryptionKeyInitialized()) initEncryptionKey(db);

  return db;
}

const UNIFIED_KEY_SETTING = 'unified_api_key';
const UNIFIED_KEY_ENCRYPTED = 'unified_api_key.encrypted';
const UNIFIED_KEY_IV = 'unified_api_key.iv';
const UNIFIED_KEY_AUTH_TAG = 'unified_api_key.auth_tag';

export function getUnifiedApiKey(): string {
  const db = getDb();

  // Try the encrypted form first.
  const encrypted = db.prepare("SELECT value FROM settings WHERE key = ?").get(UNIFIED_KEY_ENCRYPTED) as { value: string } | undefined;
  const iv = db.prepare("SELECT value FROM settings WHERE key = ?").get(UNIFIED_KEY_IV) as { value: string } | undefined;
  const authTag = db.prepare("SELECT value FROM settings WHERE key = ?").get(UNIFIED_KEY_AUTH_TAG) as { value: string } | undefined;
  if (encrypted && iv && authTag) {
    try {
      return decrypt(encrypted.value, iv.value, authTag.value);
    } catch {
      console.error('[db] Failed to decrypt unified API key — falling back to plaintext');
    }
  }

  // Legacy plaintext fallback: migrate to encrypted on first access.
  const plain = db.prepare("SELECT value FROM settings WHERE key = ?").get(UNIFIED_KEY_SETTING) as { value: string } | undefined;
  if (plain) {
    const migratedKey = plain.value;
    if (isEncryptionKeyInitialized()) {
      const { encrypted: enc, iv: encIv, authTag: encAuthTag } = encrypt(migratedKey);
      const upsert = db.transaction(() => {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_ENCRYPTED, enc);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_IV, encIv);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_AUTH_TAG, encAuthTag);
        db.prepare("DELETE FROM settings WHERE key = ?").run(UNIFIED_KEY_SETTING);
      });
      upsert();
      scheduleHydrateSecretsToRemote(db);
    }
    return migratedKey;
  }

  throw new Error('Unified API key not found. Re-initialize the database or regenerate the key via the dashboard.');
}

export function regenerateUnifiedKey(): string {
  const db = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  const { encrypted: enc, iv, authTag } = encrypt(key);
  const upsert = db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_ENCRYPTED, enc);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_IV, iv);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(UNIFIED_KEY_AUTH_TAG, authTag);
    db.prepare("DELETE FROM settings WHERE key = ?").run(UNIFIED_KEY_SETTING);
  });
  upsert();
  scheduleHydrateSecretsToRemote(db);
  return key;
}

// Generic key/value settings accessors (used by routing strategy, etc.).
export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
  scheduleHydrateSecretsToRemote(db);
}
