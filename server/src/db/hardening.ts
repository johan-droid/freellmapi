import fs from 'fs';
import Database from 'better-sqlite3';

function databasePath(db: Database.Database): string | undefined {
  const rows = db.pragma('database_list') as Array<{ name: string; file: string }>;
  return rows.find(row => row.name === 'main')?.file || undefined;
}

function lockDownFile(pathname: string | undefined): void {
  if (!pathname || pathname === ':memory:') return;

  try {
    fs.chmodSync(pathname, 0o600);
  } catch (err) {
    console.warn(`[db] Could not chmod database file to 0600: ${(err as Error).message}`);
  }

  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${pathname}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    try {
      fs.chmodSync(sidecar, 0o600);
    } catch (err) {
      console.warn(`[db] Could not chmod database sidecar ${suffix} to 0600: ${(err as Error).message}`);
    }
  }
}

export function hardenDatabase(db: Database.Database): void {
  // Avoid SQLITE_BUSY crashes under concurrent dashboard + proxy writes.
  db.pragma('busy_timeout = 5000');

  // Production safety: FULL is more durable than NORMAL if the host restarts or
  // the container is killed while SQLite is flushing WAL pages.
  db.pragma('synchronous = FULL');

  // Keep WAL bounded so small Render disks/S3-backed persistent volumes do not
  // grow forever during heavy proxy usage.
  db.pragma('wal_autocheckpoint = 1000');

  // Make constraints explicit for every connection and clean up planner state.
  db.pragma('foreign_keys = ON');
  db.pragma('optimize');

  lockDownFile(databasePath(db));
}
