import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { getProviderDefinition } from '../providers/definitions/index.js';
import { generateOAuthState, validateAndConsumeOAuthState, buildDynamicOAuthCallbackUrl } from '../security/oauth.js';
import { getDb } from '../db/index.js';
import { ensurePersistenceSchema } from '../db/persistence-schema.js';
import { encryptSecret } from '../security/secrets.js';

export const oauthRouter = Router();

function idFor(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}

/**
 * Initiates OAuth authorization flow for a provider.
 */
oauthRouter.get('/:provider/authorize', (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const def = getProviderDefinition(provider);

  if (!def || def.auth.type !== 'oauth' || !def.auth.authorizationUrl) {
    res.status(400).json({ error: `Provider '${provider}' does not support OAuth authorization.` });
    return;
  }

  const clientIdEnvKey = `${provider.toUpperCase()}_CLIENT_ID`;
  const clientId = process.env[clientIdEnvKey];

  if (!clientId) {
    res.status(400).json({
      error: `OAuth Client ID not configured. Please set ${clientIdEnvKey} in server environment.`,
    });
    return;
  }

  const state = generateOAuthState(provider);
  const protocol = req.protocol || 'http';
  const callbackUrl = buildDynamicOAuthCallbackUrl(provider, req.headers.host, protocol);

  const authUrl = new URL(def.auth.authorizationUrl);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('state', state);
  if (def.auth.scopes?.length) {
    authUrl.searchParams.set('scope', def.auth.scopes.join(' '));
  }

  if (req.query.format === 'json') {
    res.json({ authorizationUrl: authUrl.toString(), state });
    return;
  }

  res.redirect(authUrl.toString());
});

/**
 * OAuth Provider Callback Endpoint.
 */
oauthRouter.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).json({ error: `OAuth authorization failed: ${error}` });
    return;
  }

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    res.status(400).json({ error: 'Missing OAuth code or state parameter.' });
    return;
  }

  const isValidState = validateAndConsumeOAuthState(state, provider);
  if (!isValidState) {
    res.status(400).json({ error: 'Invalid, expired, or forged OAuth state parameter.' });
    return;
  }

  const def = getProviderDefinition(provider);
  if (!def || !def.auth.tokenUrl) {
    res.status(400).json({ error: `OAuth configuration missing for provider '${provider}'.` });
    return;
  }

  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: `OAuth credentials missing on server for '${provider}'.` });
    return;
  }

  try {
    const protocol = req.protocol || 'http';
    const callbackUrl = buildDynamicOAuthCallbackUrl(provider, req.headers.host, protocol);

    const tokenResponse = await fetch(def.auth.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      res.status(tokenResponse.status).json({ error: `Token exchange failed with HTTP ${tokenResponse.status}` });
      return;
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string; token_type?: string; error?: string };
    if (!tokenData.access_token) {
      res.status(400).json({ error: tokenData.error || 'No access token received from provider token exchange.' });
      return;
    }

    // Encrypt and store credential securely
    ensurePersistenceSchema(getDb());
    const db = getDb();
    const encrypted = encryptSecret(tokenData.access_token);
    const accountId = idFor(provider, 'oauth', Date.now().toString());

    db.prepare(`
      INSERT INTO provider_accounts (id, provider_slug, display_name, encrypted_api_key, key_iv, key_auth_tag, key_hint, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      accountId,
      provider,
      `${def.name} OAuth Account`,
      encrypted.encrypted,
      encrypted.iv,
      encrypted.authTag,
      encrypted.hint
    );

    res.json({
      success: true,
      provider,
      accountId,
      message: `${def.name} successfully connected via OAuth.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: `OAuth callback execution error: ${err?.message || err}` });
  }
});
