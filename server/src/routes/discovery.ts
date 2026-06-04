import { Router } from 'express';
import type { Request, Response } from 'express';
import { runModelDiscovery } from '../services/modelDiscovery.js';
import { getDb } from '../db/index.js';

export const discoveryRouter = Router();

discoveryRouter.get('/status', (req: Request, res: Response) => {
  const db = getDb();

  // Get recent events
  const events = db.prepare(`
    SELECT * FROM model_change_events
    ORDER BY created_at DESC LIMIT 50
  `).all();

  res.json({
    enabled: process.env.MODEL_DISCOVERY_ENABLED !== 'false',
    intervalMinutes: parseInt(process.env.MODEL_DISCOVERY_INTERVAL_MINUTES || '360', 10),
    recentEvents: events
  });
});

discoveryRouter.post('/run', async (req: Request, res: Response) => {
  const { provider, providerAccountId, force } = req.body;

  try {
    const summary = await runModelDiscovery({ provider, providerAccountId, force });
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
