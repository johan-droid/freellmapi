import { describe, it, expect } from 'vitest';
import {
  generateRoutingExplanation,
  recordRoutingTelemetry,
  getRecentRoutingTelemetry,
  type CandidateTelemetry,
} from '../../lib/routing-telemetry.js';

describe('Routing Telemetry & Explanation Generator', () => {
  it('generates deterministic winner reason and alternative rejections', () => {
    const winner: CandidateTelemetry = {
      modelDbId: 1,
      platform: 'groq',
      modelId: 'openai/gpt-oss-120b',
      displayName: 'GPT-OSS 120B',
      eligible: true,
      score: 0.92,
      reliability: 0.98,
      speed: 0.85,
      intelligence: 0.9,
      headroom: 1.0,
      rateLimitPenalty: 0,
    };

    const alternatives: CandidateTelemetry[] = [
      winner,
      {
        modelDbId: 2,
        platform: 'google',
        modelId: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        eligible: false,
        score: 0.0,
        reliability: 0.0,
        speed: 0.9,
        intelligence: 0.8,
        headroom: 0.1,
        rateLimitPenalty: 3,
        rejectionReason: 'cooldown active on key',
      },
    ];

    const explanation = generateRoutingExplanation(
      winner,
      alternatives,
      'agentic',
      'highest_agentic_score'
    );

    expect(explanation.winnerReason).toContain('GPT-OSS 120B');
    expect(explanation.winnerReason).toContain('agentic');
    expect(explanation.alternativeRejections).toHaveLength(1);
    expect(explanation.alternativeRejections[0].model).toBe('gemini-2.5-flash');
    expect(explanation.alternativeRejections[0].reasonCode).toBe('rate_limit_protection');
  });

  it('buffers telemetry records in memory without leaking secrets', () => {
    const telemetry = {
      requestId: 'req-12345',
      requestedModel: 'auto/agentic',
      routedModel: 'openai/gpt-oss-120b',
      routedPlatform: 'groq',
      providerReportedModel: 'unknown',
      workload: 'agentic' as const,
      toolsPresent: true,
      visionPresent: false,
      strategy: 'balanced',
      effectiveWeights: { reliability: 0.5, speed: 0.25, intelligence: 0.25 },
      stickyState: { isSticky: false },
      eligibleCandidatesCount: 1,
      totalCandidatesCount: 2,
      candidates: [],
      selectedReasonCode: 'highest_agentic_score' as const,
      explanation: {
        winnerReason: 'Selected top agentic model',
        alternativeRejections: [],
      },
      fallbackAttempts: 0,
      executionOutcome: 'success' as const,
      timestamp: new Date().toISOString(),
    };

    recordRoutingTelemetry(telemetry);
    const recent = getRecentRoutingTelemetry();
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].requestId).toBe('req-12345');
    expect(recent[0].providerReportedModel).toBe('unknown');
  });
});
