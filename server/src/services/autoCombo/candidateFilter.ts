import type { AutoCandidate, RoutingContext } from './types.js';
import type { ParsedAuto } from './parser.js';
import { isOnCooldown } from '../ratelimit.js';
import { hasProvider } from '../../providers/index.js';
import { getDb } from '../../db/index.js';

export function filterCandidates(
  pool: AutoCandidate[],
  parsed: ParsedAuto | null,
  context: RoutingContext,
): AutoCandidate[] {
  let filtered = [...pool];

  // Hard constraints: context window - never route oversized
  if (context.estimatedTotalTokens > 0) {
    filtered = filtered.filter(c => {
      if (c.contextWindow == null) return true;
      return context.estimatedTotalTokens <= c.contextWindow;
    });
    // hard: if none fit, keep empty (will produce no candidate)
  }

  // Tool / vision awareness
  if (context.hasTools) {
    const withTools = filtered.filter(c => c.supportsTools);
    if (withTools.length > 0) filtered = withTools;
    else {
      // No tool-capable model -> return empty to signal exhaustion (hard)
      return [];
    }
  }
  if (context.hasVision) {
    const withVision = filtered.filter(c => c.supportsVision);
    if (withVision.length > 0) filtered = withVision;
    else return [];
  }

  // Category / tier filtering (fail-open)
  if (parsed && parsed.isValid) {
    let catFiltered = filtered;
    if (parsed.category) {
      const cat = parsed.category;
      const before = catFiltered.length;
      catFiltered = catFiltered.filter(c => {
        const hay = `${c.provider} ${c.model} ${c.displayName}`.toLowerCase();
        if (cat === 'coding') return hay.includes('coder') || hay.includes('codestral') || hay.includes('devstral') || hay.includes('qwen3') || c.supportsTools;
        if (cat === 'reasoning') return hay.includes('reasoning') || hay.includes('deepseek-v4') || hay.includes('kimi-k2') || hay.includes('glm-4.7') || c.supportsReasoning;
        if (cat === 'vision') return !!c.supportsVision;
        if (cat === 'chat') return hay.includes('flash') || hay.includes('mini') || hay.includes('chat');
        if (cat === 'multimodal') return !!c.supportsVision; // same as vision for now
        return true;
      });
      if (catFiltered.length === 0) catFiltered = filtered; // fail-open
      filtered = catFiltered;
    }
    if (parsed.tier) {
      const tier = parsed.tier;
      const before = filtered.length;
      let tierFiltered = filtered.filter(c => {
        if (tier === 'fast') return (c.p95LatencyMs ?? 1500) < 800;
        if (tier === 'cheap') return (c.costPer1MTokens ?? 1) < 0.5;
        if (tier === 'floor') return (c.costPer1MTokens ?? 1) < 0.2;
        if (tier === 'free') return c.tier === 'free';
        if (tier === 'pro') return c.tier === 'pro' || c.tier === 'ultra';
        if (tier === 'reliable') return (c.reliabilityScore ?? 0.5) > 0.85;
        return true;
      });
      if (tierFiltered.length === 0) tierFiltered = filtered; // fail-open
      filtered = tierFiltered;
    }
    // variant (offline, smart, lkgp etc)
    if (parsed.variant) {
      if (parsed.variant === 'offline') {
        const localOnly = filtered.filter(c => {
          const p = c.provider.toLowerCase();
          return p.includes('local') || p === 'ollama_local' || p === 'lmstudio' || p === 'llamacpp' || p === 'vllm';
        });
        if (localOnly.length > 0) filtered = localOnly;
      }
    }
  }

  // Budget filtering
  if (context.budget != null) {
    const budget = context.budget;
    const affordable = filtered.filter(c => (c.costPer1MTokens ?? 0) <= budget);
    if (affordable.length > 0) {
      filtered = affordable;
    } else if (context.budgetFallback === 'strict') {
      // strict: signal empty to trigger 402
      return [];
    } else {
      // cheapest fallback: pick cheapest candidates
      // fail-open already: keep pool but later strategy will pick cheapest; we keep filtered as original but deprioritize? For strict we returned empty, else keep original
      // To honor cheapest fallback, keep all but scoring will favor cheap via cost factor. We'll not filter.
    }
  }

  // Unhealthy / circuit breaker
  filtered = filtered.filter(c => c.circuitBreakerState !== 'OPEN');

  // Credential availability: check hasProvider and isOnCooldown for at least one key
  filtered = filtered.filter(c => {
    if (!hasProvider(c.provider as any)) return false;
    // Check if all keys are on cooldown — use isOnCooldown with keyId if available
    if (c.chainRow.key_id != null) {
      if (isOnCooldown(c.provider, c.model, c.chainRow.key_id)) return false;
    }
    return true;
  });

  // Persisted overrides: fail-open if table missing
  try {
    const db = getDb();
    const rows = db.prepare("SELECT provider, model, excluded FROM auto_candidate_overrides WHERE excluded = 1").all() as any[];
    if (rows.length > 0) {
      const excludedSet = new Set(rows.map((r: any) => `${r.provider}:${r.model}`));
      const before = filtered.length;
      const after = filtered.filter(c => !excludedSet.has(`${c.provider}:${c.model}`));
      // fail-open: if filtering empties pool, keep original
      if (after.length > 0) filtered = after;
    }
  } catch {}

  return filtered;
}
