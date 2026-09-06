import { describe, expect, it } from 'vitest';
import { runMigrations, getMigrationStatuses } from '../../../db/migrate/runner.js';
import { getPostgresPool } from '../../../db/postgres.js';

describe('PostgreSQL migration runner', () => {
  it('runs pending migrations up and records applied files', async () => {
    const pool = getPostgresPool();
    await runMigrations(pool, 'up');

    const statuses = await getMigrationStatuses(pool);
    expect(statuses.length).toBe(4);
    expect(statuses.every(s => s.status === 'applied')).toBe(true);

    const res = await pool.query('SELECT filename FROM migrations ORDER BY id ASC');
    expect(res.rows.length).toBe(4);
  });
});
