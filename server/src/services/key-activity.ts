import { getDb } from '../db/index.js';
import type { Database } from 'better-sqlite3';

export interface KeyActivitySummary {
  keyId: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  lastRoutedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

const ZERO_ACTIVITY: Omit<KeyActivitySummary, 'keyId'> = {
  requestCount: 0,
  successCount: 0,
  errorCount: 0,
  lastRoutedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
};

export function getKeyActivitySummaryMap(db: Database = getDb()): Map<number, KeyActivitySummary> {
  const rows = db.prepare(`
    SELECT
      ak.id AS key_id,
      COUNT(r.id) AS request_count,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) AS error_count,
      MAX(r.created_at) AS last_routed_at,
      MAX(CASE WHEN r.status = 'success' THEN r.created_at END) AS last_success_at,
      MAX(CASE WHEN r.status = 'error' THEN r.created_at END) AS last_error_at,
      (
        SELECT r2.error
        FROM requests r2
        WHERE r2.key_id = ak.id
          AND r2.status = 'error'
        ORDER BY r2.created_at DESC, r2.id DESC
        LIMIT 1
      ) AS last_error_message
    FROM api_keys ak
    LEFT JOIN requests r ON r.key_id = ak.id
    GROUP BY ak.id
  `).all() as Array<{
    key_id: number;
    request_count: number | null;
    success_count: number | null;
    error_count: number | null;
    last_routed_at: string | null;
    last_success_at: string | null;
    last_error_at: string | null;
    last_error_message: string | null;
  }>;

  const activity = new Map<number, KeyActivitySummary>();
  for (const row of rows) {
    activity.set(row.key_id, {
      keyId: row.key_id,
      requestCount: Number(row.request_count ?? 0),
      successCount: Number(row.success_count ?? 0),
      errorCount: Number(row.error_count ?? 0),
      lastRoutedAt: row.last_routed_at,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorMessage: row.last_error_message,
    });
  }
  return activity;
}

export function getKeyActivityFor(keyId: number, db: Database = getDb()): KeyActivitySummary {
  return getKeyActivitySummaryMap(db).get(keyId) ?? { keyId, ...ZERO_ACTIVITY };
}
