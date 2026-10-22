// Real-PostgreSQL integration test for the Neon persistence layer.
//
// Skipped unless TEST_DATABASE_URL points at a PostgreSQL database, so the
// normal `npm test` run needs no database. When it is set, the test proves the
// three things the migration has to guarantee:
//
//   1. a fresh database initialises from the migrations and accepts writes;
//   2. those writes survive the application closing and reconnecting
//      (the "records are still there after a restart" requirement);
//   3. a transaction rolls back as a unit.
//
// It runs against a scratch schema so a developer's database is never touched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';

const DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('postgres persistence', () => {
  const schema = 'freellmapi_test';
  let previousSchema: string | undefined;

  beforeAll(async () => {
    previousSchema = process.env.DATABASE_URL;
    process.env.DATABASE_URL = DATABASE_URL;

    // Use a dedicated schema so the test never touches the caller's tables.
    const { connectDb, closeDb } = await import('../../db/index.js');
    const db = await connectDb(DATABASE_URL);
    await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
    await db.exec(`SET search_path TO ${schema};`);
    await closeDb();

    execFileSync('npx', ['tsx', 'src/db/migrate/cli.ts', 'up'], {
      env: { ...process.env, DATABASE_URL, PGOPTIONS: `-c search_path=${schema}` },
      stdio: 'pipe',
    });
  });

  afterAll(async () => {
    if (DATABASE_URL) {
      const { connectDb, closeDb } = await import('../../db/index.js');
      const db = await connectDb(DATABASE_URL);
      await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
      await closeDb();
    }
    if (previousSchema === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousSchema;
  });

  it('initialises the schema from the migrations', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');
    const db = await connectDb(DATABASE_URL);
    const rows = await db.all<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`,
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.map((r) => r.table_name)).toContain('api_keys');
    expect(rows.map((r) => r.table_name)).toContain('requests');
    expect(rows.map((r) => r.table_name)).toContain('migrations');
    await closeDb();
  });

  it('keeps records across a close/reopen cycle', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');

    const first = await connectDb(DATABASE_URL);
    await first.exec(`SET search_path TO ${schema};`);
    await first.run(
      `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, enabled) VALUES (?, ?, ?, ?, ?, 1) RETURNING id`,
      ['openai', 'persistence-probe', 'cipher', 'iv', 'tag'],
    );
    await closeDb();

    // A fresh pool and a fresh connection — the equivalent of a process
    // restart against the same database.
    const second = await connectDb(DATABASE_URL);
    await second.exec(`SET search_path TO ${schema};`);
    const row = await second.get<{ id: number; label: string }>(
      `SELECT id, label FROM api_keys WHERE label = 'persistence-probe'`,
    );
    expect(row).toBeDefined();
    expect(row!.label).toBe('persistence-probe');
    await second.run(`DELETE FROM api_keys WHERE label = 'persistence-probe'`);
    await closeDb();
  });

  it('rolls a failed transaction back as a unit', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');
    const db = await connectDb(DATABASE_URL);
    await db.exec(`SET search_path TO ${schema};`);

    await expect(db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, enabled) VALUES (?, ?, ?, ?, ?, 1)`,
        ['openai', 'rolled-back', 'cipher', 'iv', 'tag'],
      );
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const row = await db.get(`SELECT id FROM api_keys WHERE label = 'rolled-back'`);
    expect(row).toBeUndefined();
    await closeDb();
  });

  it('commits a successful transaction', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');
    const db = await connectDb(DATABASE_URL);
    await db.exec(`SET search_path TO ${schema};`);

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, enabled) VALUES (?, ?, ?, ?, ?, 1)`,
        ['openai', 'committed', 'cipher', 'iv', 'tag'],
      );
    });

    const row = await db.get(`SELECT id FROM api_keys WHERE label = 'committed'`);
    expect(row).toBeDefined();
    await db.run(`DELETE FROM api_keys WHERE label = 'committed'`);
    await closeDb();
  });

  it('reports affected rows for writes', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');
    const db = await connectDb(DATABASE_URL);
    await db.exec(`SET search_path TO ${schema};`);

    const result = await db.run(
      `INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, enabled) VALUES (?, ?, ?, ?, ?, 1) RETURNING id`,
      ['openai', 'rowcount', 'cipher', 'iv', 'tag'],
    );
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBeDefined();

    const deleted = await db.run(`DELETE FROM api_keys WHERE label = 'rowcount'`);
    expect(deleted.changes).toBe(1);
    await closeDb();
  });

  it('guarantees encrypted API-key persistence, decryption, and integrity across restarts and migrations', async () => {
    const { connectDb, closeDb } = await import('../../db/index.js');
    const { initEncryptionKey, encrypt, decrypt } = await import('../../lib/crypto.js');
    const { runMigrations } = await import('../../db/migrate/runner.js');

    // 1. Establish initial process session
    const firstDb = await connectDb(DATABASE_URL);
    await firstDb.exec(`SET search_path TO ${schema};`);
    await initEncryptionKey(firstDb);

    const rawSecret = 'sk-audit-secret-key-1234567890abcdef';
    const encrypted = encrypt(rawSecret);

    const inserted = await firstDb.run(`
      INSERT INTO api_keys (
        platform, label, encrypted_key, iv, auth_tag, enabled, status, monthly_request_cap, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'healthy', 5000, to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
      RETURNING id
    `, ['groq', 'audit-persistent-key', encrypted.encrypted, encrypted.iv, encrypted.authTag]);

    const keyId = inserted.lastInsertRowid;
    expect(keyId).toBeDefined();

    // 2. Simulate complete process restart (terminate pool, drop memory state)
    await closeDb();

    // 3. New process startup against the same persistent PostgreSQL
    const secondDb = await connectDb(DATABASE_URL);
    await secondDb.exec(`SET search_path TO ${schema};`);
    await initEncryptionKey(secondDb);

    const fetched = await secondDb.get<{
      id: number;
      platform: string;
      label: string;
      encrypted_key: string;
      iv: string;
      auth_tag: string;
      status: string;
      monthly_request_cap: number;
    }>(`SELECT * FROM api_keys WHERE id = ?`, [keyId]);

    expect(fetched).toBeDefined();
    expect(fetched!.label).toBe('audit-persistent-key');
    expect(fetched!.status).toBe('healthy');
    expect(fetched!.monthly_request_cap).toBe(5000);

    // Verify decryption succeeds and yields exact original plaintext
    const decrypted = decrypt(fetched!.encrypted_key, fetched!.iv, fetched!.auth_tag);
    expect(decrypted).toBe(rawSecret);

    // 4. Update key status and verify updates persist
    await secondDb.run(
      `UPDATE api_keys SET status = 'cooldown', last_checked_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
      [keyId],
    );

    // 5. Re-run migrations over the active database (simulating a subsequent deployment)
    await runMigrations(secondDb, 'up');

    // 6. Simulate another process restart
    await closeDb();

    const thirdDb = await connectDb(DATABASE_URL);
    await thirdDb.exec(`SET search_path TO ${schema};`);
    await initEncryptionKey(thirdDb);

    const afterMigration = await thirdDb.get<{
      status: string;
      last_checked_at: string;
      encrypted_key: string;
      iv: string;
      auth_tag: string;
    }>(`SELECT status, last_checked_at, encrypted_key, iv, auth_tag FROM api_keys WHERE id = ?`, [keyId]);

    expect(afterMigration?.status).toBe('cooldown');
    expect(afterMigration?.last_checked_at).toBeDefined();
    expect(decrypt(afterMigration!.encrypted_key, afterMigration!.iv, afterMigration!.auth_tag)).toBe(rawSecret);

    // Cleanup
    await thirdDb.run(`DELETE FROM api_keys WHERE id = ?`, [keyId]);
    await closeDb();
  });
});
