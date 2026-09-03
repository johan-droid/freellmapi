import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { VALID_CATEGORIES, VALID_TIERS, parseAutoPrefix } from '../services/autoCombo/parser.js';
import { getAutoCandidatesForApi, selectAutoCandidate, buildRoutingContext } from '../services/autoCombo/engine.js';
import { getExplorationRate, setExplorationRate } from '../services/autoCombo/exploration.js';
import { getExclusionState, isIncidentMode } from '../services/autoCombo/selfHealing.js';
import { buildCandidatePool } from '../services/autoCombo/candidateFactory.js';
import { listRouterStrategies, getRouterStrategy } from '../services/autoCombo/routerStrategy.js';
import { ensureStrategies } from '../services/autoCombo/engine.js';

export const autoComboRouter = Router();

// GET /api/auto-combo — discovery
autoComboRouter.get('/', (_req: Request, res: Response) => {
  ensureStrategies();
  const baseModels = [
    'auto',
    'auto/coding',
    'auto/fast',
    'auto/cheap',
    'auto/reliable',
    'auto/offline',
    'auto/smart',
    'auto/lkgp',
  ];
  // dynamic combos
  const combos: string[] = [];
  for (const cat of VALID_CATEGORIES) {
    combos.push(`auto/${cat}`);
    for (const tier of VALID_TIERS) {
      combos.push(`auto/${cat}:${tier}`);
    }
  }
  // Provide metadata via building pool
  let candidateCount = 0;
  let contextWindow: number | null = null;
  try {
    const pool = buildCandidatePool({ estimatedInputTokens: 100, estimatedOutputTokens: 512, estimatedTotalTokens: 612, hasTools: false, hasVision: false });
    candidateCount = pool.length;
    const windows = pool.map(c => c.contextWindow).filter((c): c is number => c != null);
    contextWindow = windows.length ? Math.max(...windows) : null;
  } catch {}
  res.json({
    supported: [...baseModels, ...combos],
    strategies: listRouterStrategies(),
    explorationRate: getExplorationRate(),
    candidateCount,
    context_length: contextWindow,
    context_window: contextWindow,
    max_output_tokens: 4096,
    capabilities: { vision: true, tools: true, reasoning: true },
  });
});

// GET /api/auto-combo/candidates — per-key controls expose
autoComboRouter.get('/candidates', (_req: Request, res: Response) => {
  try {
    const candidates = getAutoCandidatesForApi();
    res.json(candidates);
  } catch (e: any) {
    res.status(500).json({ error: { message: e?.message ?? 'failed to load candidates' } });
  }
});

// GET /api/auto-combo/status — router status dashboard
autoComboRouter.get('/status', (_req: Request, res: Response) => {
  try {
    const pool = buildCandidatePool({ estimatedInputTokens: 100, estimatedOutputTokens: 512, estimatedTotalTokens: 612, hasTools: false, hasVision: false });
    const healthy = pool.filter(c => c.circuitBreakerState === 'CLOSED').length;
    const degraded = pool.filter(c => c.circuitBreakerState === 'HALF_OPEN').length;
    const unavailable = pool.filter(c => c.circuitBreakerState === 'OPEN').length;
    const incident = isIncidentMode(pool);
    res.json({
      activeProviders: new Set(pool.map(c => c.provider)).size,
      eligibleCandidates: pool.length,
      healthy,
      degraded,
      unavailable,
      incidentMode: incident,
      currentStrategy: 'rules',
      exploration: getExplorationRate(),
      topProviders: pool.slice(0, 5).map(c => ({ provider: c.provider, model: c.model, score: c._finalScore ?? 0.5 })),
      exclusions: [...getExclusionState().entries()].map(([k, v]) => ({ key: k, until: v.until, attempts: v.attempts })),
    });
  } catch (e: any) {
    res.status(500).json({ error: { message: e?.message ?? 'failed' } });
  }
});

// GET /api/auto-combo/:channel/candidates — channel-specific (api key identity)
autoComboRouter.get('/:channel/candidates', (req: Request, res: Response) => {
  const candidates = getAutoCandidatesForApi();
  res.json(candidates.map(c => ({ ...c, channel: req.params.channel })));
});

// POST /api/auto-combo/candidates/:provider/:model/exclude
autoComboRouter.post('/candidates/:provider/:model/exclude', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS auto_candidate_overrides (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      excluded INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, model)
    )`);
    db.prepare(`INSERT OR REPLACE INTO auto_candidate_overrides (provider, model, excluded, reason) VALUES (?, ?, 1, ?)`).run(req.params.provider, req.params.model, (req.body as any)?.reason ?? 'manual exclude');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: { message: e?.message ?? 'failed' } });
  }
});

autoComboRouter.post('/candidates/:provider/:model/restore', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM auto_candidate_overrides WHERE provider = ? AND model = ?`).run(req.params.provider, req.params.model);
    // also clear from legacy table if exists
    try { db.prepare(`DELETE FROM auto_candidate_overrides WHERE provider = ? AND model = ?`).run(req.params.provider, req.params.model); } catch {}
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: { message: e?.message ?? 'failed' } });
  }
});

// POST /api/auto-combo/exploration
autoComboRouter.post('/exploration', (req: Request, res: Response) => {
  const rate = (req.body as any)?.rate;
  if (typeof rate !== 'number' || rate < 0 || rate > 1) {
    res.status(400).json({ error: { message: 'rate must be 0..1' } });
    return;
  }
  setExplorationRate(rate);
  res.json({ success: true, rate });
});
