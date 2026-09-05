import { Router } from 'express';
import type { Request, Response } from 'express';
import { getActiveRegistry } from '../services/router-registry.js';
import { hasProvider } from '../providers/index.js';
import type { Platform } from '@freellmapi/shared/types.js';

export const healthRouter = Router();

// GET /api/health - System and provider health status
healthRouter.get('/', (_req: Request, res: Response) => {
  try {
    const registry = getActiveRegistry();
    const providers = registry.getAllProviders();
    const credentials = registry.getAllCredentials();
    const now = Date.now();

    const providerHealthList = providers.map(p => {
      const creds = registry.getCredentialsForProvider(p.id);
      const totalKeys = creds.length;
      const enabledKeys = creds.filter(c => c.enabled).length;
      const healthyKeys = creds.filter(c => c.enabled && c.runtime.cooldownUntil <= now).length;
      const rateLimitedKeys = creds.filter(c => c.enabled && c.runtime.cooldownUntil > now).length;
      const invalidKeys = creds.filter(c => !c.enabled).length;

      let status = 'unknown';
      if (!p.enabled || enabledKeys === 0) {
        status = 'disabled';
      } else if (healthyKeys > 0) {
        status = 'healthy';
      } else if (rateLimitedKeys > 0) {
        status = 'cooldown';
      } else {
        status = 'degraded';
      }

      return {
        platform: p.key,
        displayName: p.displayName,
        hasProvider: hasProvider(p.key as Platform),
        status,
        totalKeys,
        enabledKeys,
        healthyKeys,
        rateLimitedKeys,
        invalidKeys,
        errorKeys: 0,
        unknownKeys: 0,
      };
    });

    const keyHealthList = credentials.map(c => {
      const isCooldown = c.runtime.cooldownUntil > now;
      let status = 'healthy';
      if (!c.enabled) {
        status = 'invalid';
      } else if (isCooldown) {
        status = 'rate_limited';
      } else if (c.runtime.circuitState === 'DEGRADED') {
        status = 'degraded';
      }

      return {
        id: c.id,
        platform: c.providerKey,
        label: c.name,
        status,
        enabled: c.enabled,
        activeRequests: c.runtime.activeRequests,
        ewmaLatencyMs: c.runtime.ewmaLatencyMs,
        cooldownRemainingMs: Math.max(0, c.runtime.cooldownUntil - now),
        lastUsedAt: c.runtime.lastUsedAt ? new Date(c.runtime.lastUsedAt).toISOString() : null,
        lastFailedAt: c.runtime.lastFailedAt ? new Date(c.runtime.lastFailedAt).toISOString() : null,
        lastCheckedAt: c.runtime.lastUsedAt ? new Date(c.runtime.lastUsedAt).toISOString() : null,
        lastHealthError: c.runtime.lastHealthError,
      };
    });

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      platforms: providerHealthList,
      keys: keyHealthList,
    });
  } catch (err: any) {
    console.error('[health] Error getting health status:', err);
    res.status(500).json({ error: 'Failed to get health status' });
  }
});
