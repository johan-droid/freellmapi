import { getDb } from '../db/index.js';

export function getQuotaProfile(provider: string, modelId: string | null, scope: string) {
  const db = getDb();
  let query = 'SELECT * FROM provider_quota_profiles WHERE provider = ? AND quota_scope = ?';
  const params: any[] = [provider, scope];

  if (modelId) {
    query += ' AND model_id = ?';
    params.push(modelId);
  } else {
    query += ' AND model_id IS NULL';
  }

  return db.prepare(query).get(...params) as any;
}

export function getRemainingQuota(candidate: any) {
  const db = getDb();
  return { available: true };
}
