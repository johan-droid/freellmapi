import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { encrypt } from '../lib/crypto.js';

export const providersRouter = Router();

// GET /api/providers
providersRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();

  // Basic stats per provider
  const stats = db.prepare(`
    SELECT
      p.provider,
      COUNT(DISTINCT p.id) as accounts_count,
      COUNT(DISTINCT c.id) as credentials_count
    FROM provider_accounts p
    LEFT JOIN provider_credentials c ON c.provider_account_id = p.id
    GROUP BY p.provider
  `).all() as any[];

  res.json(stats.map(s => ({
    id: s.provider,
    displayName: s.provider, // You could map to real names using the registry
    accountCount: s.accounts_count,
    credentialCount: s.credentials_count
  })));
});

// GET /api/provider-accounts
providersRouter.get('/accounts', (req: Request, res: Response) => {
  const db = getDb();
  const accounts = db.prepare('SELECT id, provider, label, email_hint as emailHint, status, enabled, created_at as createdAt, updated_at as updatedAt, last_checked_at as lastCheckedAt FROM provider_accounts').all();
  res.json(accounts);
});

// POST /api/provider-accounts
providersRouter.post('/accounts', (req: Request, res: Response) => {
  const { provider, label, emailHint, enabled } = req.body;
  const db = getDb();

  try {
    const info = db.prepare('INSERT INTO provider_accounts (provider, label, email_hint, enabled) VALUES (?, ?, ?, ?)').run(
      provider,
      label,
      emailHint || null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );
    res.json({ id: info.lastInsertRowid, provider, label, emailHint, enabled: enabled !== false });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/provider-accounts/:id
providersRouter.patch('/accounts/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const { label, emailHint, enabled } = req.body;
  const db = getDb();

  try {
    const account = db.prepare('SELECT * FROM provider_accounts WHERE id = ?').get(id) as any;
    if (!account) return res.status(404).json({ error: 'Account not found' });

    db.prepare('UPDATE provider_accounts SET label = ?, email_hint = ?, enabled = ?, updated_at = datetime("now") WHERE id = ?').run(
      label !== undefined ? label : account.label,
      emailHint !== undefined ? emailHint : account.email_hint,
      enabled !== undefined ? (enabled ? 1 : 0) : account.enabled,
      id
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/provider-accounts/:id
providersRouter.delete('/accounts/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const db = getDb();

  // Soft disable
  db.prepare('UPDATE provider_accounts SET enabled = 0, updated_at = datetime("now") WHERE id = ?').run(id);
  res.json({ success: true });
});


// GET /api/provider-credentials
providersRouter.get('/credentials', (req: Request, res: Response) => {
  const db = getDb();
  // Don't return encrypted_key, iv, auth_tag to the frontend
  const credentials = db.prepare('SELECT id, provider_account_id as providerAccountId, provider, label, base_url as baseUrl, status, enabled, created_at as createdAt, last_checked_at as lastCheckedAt FROM provider_credentials').all();
  res.json(credentials);
});

// POST /api/provider-accounts/:id/credentials
providersRouter.post('/accounts/:id/credentials', (req: Request, res: Response) => {
  const accountId = req.params.id;
  const { label, apiKey, baseUrl } = req.body;
  const db = getDb();

  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const account = db.prepare('SELECT * FROM provider_accounts WHERE id = ?').get(accountId) as any;
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { encrypted, iv, authTag } = encrypt(apiKey);

    const info = db.prepare(`
      INSERT INTO provider_credentials
      (provider_account_id, provider, label, encrypted_key, iv, auth_tag, base_url, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(accountId, account.provider, label || '', encrypted, iv, authTag, baseUrl || null);

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/provider-credentials/:id
providersRouter.patch('/credentials/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const { label, enabled, baseUrl } = req.body;
  const db = getDb();

  try {
    const cred = db.prepare('SELECT * FROM provider_credentials WHERE id = ?').get(id) as any;
    if (!cred) return res.status(404).json({ error: 'Credential not found' });

    db.prepare('UPDATE provider_credentials SET label = ?, enabled = ?, base_url = ? WHERE id = ?').run(
      label !== undefined ? label : cred.label,
      enabled !== undefined ? (enabled ? 1 : 0) : cred.enabled,
      baseUrl !== undefined ? baseUrl : cred.base_url,
      id
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/provider-credentials/:id
providersRouter.delete('/credentials/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const db = getDb();

  // Soft disable
  db.prepare('UPDATE provider_credentials SET enabled = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});
