import { recordRequestTelemetry } from '../services/analytics-aggregator.js';
import { getActiveRegistry } from '../services/router-registry.js';
import type { RequestTrace } from './attempt-trace.js';

// Memory-first zero-DB request logging
export function logRequest(
  platform: string,
  modelId: string,
  keyId: number | null,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
  _ttfbMs: number | null = null,
  _requestedModel: string | null = null,
  _servedModel: string | null = null,
) {
  try {
    const isSuccess = status === 'success';
    const isRateLimit = error?.includes('429') || error?.toLowerCase().includes('rate limit');
    const isTimeout = error?.toLowerCase().includes('timeout');

    // Find provider ID from active registry if available
    let providerId: number | null = null;
    const registry = getActiveRegistry();
    if (registry) {
      const p = registry.getProviderByKey(platform.toLowerCase());
      if (p) providerId = p.id;
    }

    recordRequestTelemetry({
      providerId,
      providerKey: platform,
      modelId,
      success: isSuccess,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      totalTokens: (inputTokens || 0) + (outputTokens || 0),
      latencyMs: latencyMs || 0,
      isRateLimit: !!isRateLimit,
      isTimeout: !!isTimeout,
    });
  } catch (e) {
    // Analytics logging failure must never crash inference
    console.error('[request-log] Error recording telemetry:', e);
  }
}

export function persistRequestAttempts(_trace: RequestTrace): void {
  // Runtime request attempts are tracked in memory metrics
}
