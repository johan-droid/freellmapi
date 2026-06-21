import { installLogRedaction } from './lib/redact.js';
installLogRedaction();

import { createApp } from './app.js';
import { initDb, getSetting } from './db/index.js';
import { hardenDatabase } from './db/hardening.js';
import { hasRemoteSecretsStore } from './services/remote-secrets.js';
import { startHealthChecker } from './services/health.js';
import { getDatabasePath, restoreDatabaseBeforeBoot, startDatabaseSnapshotLoop } from './storage/persistence.js';
import { startCatalogSync } from './services/catalog-sync.js';
import { applyProxyUrl, applyProxyEnabled, applyProxyBypass } from './lib/proxy.js';
import { installProcessSafetyNet } from './lib/process-safety-net.js';

const PORT = process.env.PORT ?? 3001;
// IPv4-only ('0.0.0.0') by default so Render can detect the bound port.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  // Install first so a late provider socket reset (undici HTTP/2 error with no
  // listener) can't take the proxy down. Genuine bugs still exit 1.
  installProcessSafetyNet();

  await restoreDatabaseBeforeBoot();
  const db = initDb(getDatabasePath());
  hardenDatabase(db);
  const stopSnapshots = startDatabaseSnapshotLoop();

  // Load the persisted proxy settings from the DB (env var wins if set).
  // Must happen after initDb so the settings table is ready.
  applyProxyUrl(getSetting('proxy_url') ?? '');
  applyProxyEnabled(getSetting('proxy_enabled') !== '0'); // default: enabled
  applyProxyBypass(getSetting('proxy_bypass') ?? '');

  const app = createApp();

  const onReady = (host: string) => () => {
    const display = host.includes(':') ? `[${host}]` : host;
    console.log(`Server running on http://${display}:${PORT}`);
    console.log(`Proxy endpoint: http://${display}:${PORT}/v1/chat/completions`);
    startHealthChecker();
    startCatalogSync();
  };

  const server = app.listen(Number(PORT), HOST, onReady(HOST));
  if (hasRemoteSecretsStore()) {
    console.log('[db] Remote secret mirror is enabled via DATABASE_URL (Neon/Postgres).');
  } else {
    console.log('[db] Running in SQLite-only mode. Set DATABASE_URL to mirror settings/api keys to Neon/Postgres.');
  }
  server.on('close', stopSnapshots);
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
    process.exit(1);
  });
}

main().catch((err) => {
  // A boot failure (e.g. a missing production ENCRYPTION_KEY) must exit
  // non-zero rather than leaving a half-initialized process that never starts
  // listening — that silent state is what surfaces in the client as
  // "Can't reach the server".
  console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
  process.exit(1);
});
