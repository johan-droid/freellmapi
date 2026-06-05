import fs from 'fs';
import path from 'path';
import { downloadDbSnapshot, uploadDbSnapshot, uploadTimestampedBackup } from './b2.js';

export function getDatabasePath(): string | undefined {
  return process.env.DATABASE_PATH?.trim() || undefined;
}

export async function restoreDatabaseBeforeBoot(): Promise<void> {
  const dbPath = getDatabasePath();
  if (!dbPath || dbPath === ':memory:') return;
  if (fs.existsSync(dbPath)) return;
  if (process.env.B2_RESTORE_ON_BOOT !== 'true') return;

  try {
    const restored = await downloadDbSnapshot(dbPath);
    if (restored) {
      console.log(`[persistence] Restored SQLite database from Backblaze B2 to ${dbPath}`);
      return;
    }
    const allowEmpty = process.env.ALLOW_EMPTY_DB_ON_RESTORE_FAILURE === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowEmpty) {
      throw new Error('No remote DB snapshot exists and empty production DB is not allowed. Set ALLOW_EMPTY_DB_ON_RESTORE_FAILURE=true to bootstrap intentionally.');
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    console.warn('[persistence] No B2 DB snapshot found; bootstrapping a new local SQLite DB.');
  } catch (error) {
    const allowEmpty = process.env.ALLOW_EMPTY_DB_ON_RESTORE_FAILURE === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowEmpty) throw error;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    console.warn(`[persistence] B2 restore failed; continuing with empty DB because fallback is allowed: ${(error as Error).message}`);
  }
}

export function startDatabaseSnapshotLoop(): () => void {
  const dbPath = getDatabasePath();
  if (!dbPath || dbPath === ':memory:' || process.env.PERSISTENCE_BACKEND !== 'backblaze_b2') {
    return () => undefined;
  }

  const intervalSeconds = Number(process.env.B2_SNAPSHOT_INTERVAL_SECONDS ?? 300);
  const intervalMs = Math.max(60, intervalSeconds) * 1000;

  const snapshot = async () => {
    if (!fs.existsSync(dbPath)) return;
    try {
      await uploadDbSnapshot(dbPath);
      await uploadTimestampedBackup(dbPath);
      console.log('[persistence] Uploaded SQLite snapshot to Backblaze B2.');
    } catch (error) {
      console.warn(`[persistence] Snapshot upload failed: ${(error as Error).message}`);
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
