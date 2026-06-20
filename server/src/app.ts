import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { responsesRouter } from './routes/responses.js';
import { fallbackRouter } from './routes/fallback.js';
import { profilesRouter } from './routes/profiles.js';
import { embeddingsRouter } from './routes/embeddings.js';
import { analyticsRouter } from './routes/analytics.js';
import { analyticsExtraRouter } from './routes/analytics-extra.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { premiumRouter } from './routes/premium.js';
import { authRouter } from './routes/auth.js';
import { providersRouter, providerAccountsRouter, modelDiscoveryRouter } from './routes/providers.js';
import { storageRouter } from './routes/storage.js';
import { requireAuth } from './middleware/requireAuth.js';
import { createProxyRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

function getAllowedCorsOrigins() {
  const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        // Tailwind/shadcn use generated style attributes/classes. Keep inline
        // styles allowed while blocking external style origins.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...allowedCorsOrigins],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-FreeLLMAPI-Client', 'X-Client-Name'],
    maxAge: 600,
  }));
  // 10mb: code agents (OpenCode, AionUI, Qwen Code) ship very large system
  // prompts + tool schemas + repo context; 1mb cut their sessions off
  // mid-conversation with an opaque 413. (#200)
  app.use(express.json({ limit: '10mb' }));

  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? '1mb' }));

  // Never cache authenticated/admin API responses. Several endpoints expose
  // masked credential metadata or one-time key reveals/regenerations.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.use('/api/auth', authRouter);

  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/profiles', requireAuth, profilesRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/embeddings', requireAuth, embeddingsRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/analytics', requireAuth, analyticsExtraRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/premium', requireAuth, premiumRouter);
  app.use('/api/providers', requireAuth, providersRouter);
  app.use('/api/provider-accounts', requireAuth, providerAccountsRouter);
  app.use('/api/model-discovery', requireAuth, modelDiscoveryRouter);
  app.use('/api/storage', requireAuth, storageRouter);

  app.use('/v1', createProxyRateLimiter());
  app.use('/v1', proxyRouter);
  app.use('/v1', responsesRouter);

  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);

  // Serve client static files (after API error handler)
  const clientDist = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
