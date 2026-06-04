import { describe, it, expect } from 'vitest';
import { getDb, initDb } from '../../db/index.js';

describe('DB Migration Layer', () => {
  it('should create new provider hierarchy tables', () => {
    initDb(':memory:');
    const db = getDb();

    const accountsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_accounts'").get();
    expect(accountsTable).toBeDefined();

    const credentialsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_credentials'").get();
    expect(credentialsTable).toBeDefined();

    const snapshotsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_model_snapshots'").get();
    expect(snapshotsTable).toBeDefined();

    // Verify models table gained dynamic and deprecated columns
    const columns = db.prepare("PRAGMA table_info(models)").all() as any[];
    expect(columns.some((c: any) => c.name === 'dynamic')).toBe(true);
    expect(columns.some((c: any) => c.name === 'deprecated')).toBe(true);
  });
});
