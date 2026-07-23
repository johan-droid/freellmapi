const DEFAULT_RPM = 120;

function parseRateLimitRpm(): number {
  const raw = process.env.PROXY_RATE_LIMIT_RPM;
  if (raw === undefined || raw.trim() === '') return DEFAULT_RPM;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RPM;
  return Math.floor(n);
}

export interface TlsConfig {
  certPath: string;
  keyPath: string;
}

export interface Config {
  port: number | string;
  host: string;
  dbPath: string | null;
  dashboardOrigins: string[];
  clientDist: string | null;
  proxyRateLimitRpm: number;
  nodeEnv: string;
  serveStaticAssets: boolean;
  tls: TlsConfig | null;
  requireOrigin: boolean;
}

function parseOptionalTls(): TlsConfig | null {
  const certPath = process.env.TLS_CERT_PATH?.trim();
  const keyPath = process.env.TLS_KEY_PATH?.trim();
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    console.warn('[config] Both TLS_CERT_PATH and TLS_KEY_PATH must be set for HTTPS — falling back to HTTP');
    return null;
  }
  return { certPath, keyPath };
}

export function loadConfig(): Config {
  return {
    port: process.env.PORT ?? 3001,
    // Dual-stack ('::') by default so the dashboard is reachable over both IPv4
    // and IPv6 (e.g. IPv6-enabled Docker networks — #180). Hosts with IPv6
    // disabled fall back to IPv4-only below; HOST overrides the default outright.
    host: process.env.HOST ?? '::',
    dbPath: process.env.FREEAPI_DB_PATH?.trim() ||
      process.env.DATABASE_PATH?.trim() ||
      process.env.DB_PATH?.trim() ||
      null,
    dashboardOrigins: (process.env.DASHBOARD_ORIGINS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    clientDist: process.env.CLIENT_DIST ?? null,
    proxyRateLimitRpm: parseRateLimitRpm(),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    serveStaticAssets: true,
    tls: parseOptionalTls(),
    requireOrigin: process.env.REQUIRE_ORIGIN === 'true',
  };
}
