import type { Request } from 'express';

export type BudgetFallback = 'cheapest' | 'strict';

export interface RequestControls {
  mode?: string;
  budget?: number | null;
  budgetFallback?: BudgetFallback;
  slaTargetP95Ms?: number;
  slaMaxErrorRate?: number;
  slaMaxCostPer1MTokens?: number;
  slaHardConstraints?: boolean;
}

function parseBudgetValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseRequestControls(req: Request): RequestControls {
  const modeHeader = (req.headers['x-freellmapi-mode'] as string | undefined)
    ?? (req.headers['x-omnroute-mode'] as string | undefined)
    ?? (req.headers['x-routing-mode'] as string | undefined);
  const budgetHeader = (req.headers['x-freellmapi-budget'] as string | undefined)
    ?? (req.headers['x-budget'] as string | undefined);
  const fallbackHeader = (req.headers['x-freellmapi-budget-fallback'] as string | undefined)
    ?? (req.headers['x-budget-fallback'] as string | undefined);

  const mode = modeHeader?.trim().toLowerCase();
  const validModes = new Set(['fast','balanced','quality','cheap','reliable','offline','ship-fast','cost-saver','quality-first','offline-friendly','reliability-first','chaos-mode']);
  const normalizedMode = mode && validModes.has(mode) ? mode : undefined;

  const budget = parseBudgetValue(budgetHeader);

  let budgetFallback: BudgetFallback | undefined;
  if (fallbackHeader) {
    const f = fallbackHeader.trim().toLowerCase();
    if (f === 'cheapest' || f === 'strict') budgetFallback = f;
  }

  // SLA headers optional: X-FreeLLMAPI-SLA-P95 etc
  const slaP95 = req.headers['x-freellmapi-sla-p95'] as string | undefined;
  const slaErr = req.headers['x-freellmapi-sla-error'] as string | undefined;
  const slaCost = req.headers['x-freellmapi-sla-cost'] as string | undefined;
  const slaHard = req.headers['x-freellmapi-sla-hard'] as string | undefined;

  const controls: RequestControls = {};
  if (normalizedMode) controls.mode = normalizedMode;
  if (budget != null) controls.budget = budget;
  if (budgetFallback) controls.budgetFallback = budgetFallback;
  if (slaP95) { const n = Number(slaP95); if (Number.isFinite(n) && n > 0) controls.slaTargetP95Ms = n; }
  if (slaErr) { const n = Number(slaErr); if (Number.isFinite(n) && n >= 0 && n <= 1) controls.slaMaxErrorRate = n; }
  if (slaCost) { const n = Number(slaCost); if (Number.isFinite(n) && n > 0) controls.slaMaxCostPer1MTokens = n; }
  if (slaHard) controls.slaHardConstraints = slaHard.trim().toLowerCase() === 'true' || slaHard.trim() === '1';

  return controls;
}

export function resolveControlsBody(body: any, headerControls: RequestControls): RequestControls {
  // Body may contain config for persisted auto combos; merge but headers win
  const controls: RequestControls = { ...headerControls };
  if (!controls.mode && typeof body?.mode === 'string') controls.mode = body.mode;
  if (controls.budget == null && typeof body?.budget === 'number') controls.budget = body.budget;
  return controls;
}
