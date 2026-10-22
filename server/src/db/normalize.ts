import type { Db } from './types.js';

/**
 * In older iterations of the PostgreSQL schema or external databases, boolean flags
 * (such as `enabled`, `supports_vision`, `supports_tools`, `is_favorite`, `is_full`)
 * may have been defined as PostgreSQL native `boolean` instead of SQLite-compatible `bigint`.
 *
 * PostgreSQL rejects integer assignments and comparisons to `boolean` columns
 * (e.g. `column "enabled" is of type boolean but expression is of type integer` or
 * `operator does not exist: boolean = integer`).
 *
 * This pre-flight migration detects any boolean flag columns in the active schema
 * and safely normalizes them to BIGINT (0/1) with appropriate defaults.
 */
export async function normalizeLegacyBooleanColumns(db: Db): Promise<void> {
  try {
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
  } catch (err: any) {
    console.warn(`[db] note: boolean column normalization check: ${err?.message ?? err}`);
  }
}
