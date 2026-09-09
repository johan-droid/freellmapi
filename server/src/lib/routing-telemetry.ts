export interface CandidateTelemetry {
  modelDbId: number;
  platform: string;
  modelId: string;
  displayName: string;
  eligible: boolean;
  score: number;
  reliability: number;
  speed: number;
  intelligence: number;
  headroom: number;
  rateLimitPenalty: number;
  rejectionReason?: string;
  workloadQuality?: number;
}

export type SelectionReasonCode =
  | 'highest_score'
  | 'highest_coding_score'
  | 'highest_agentic_score'
  | 'sticky_session'
  | 'exploration'
  | 'only_eligible_model'
  | 'quota_protection'
  | 'rate_limit_protection'
  | 'fallback';

export interface AlternativeRejection {
  model: string;
  platform: string;
  reasonCode: string;
  details: string;
}

export interface RoutingTelemetry {
  requestId: string;
  requestedModel: string;
  routedModel: string;
  routedPlatform: string;
  providerReportedModel: string;
  workload: 'chat' | 'coding' | 'agentic' | 'vision';
  toolsPresent: boolean;
  visionPresent: boolean;
  strategy: string;
  effectiveWeights: { reliability: number; speed: number; intelligence: number };
  stickyState: {
    isSticky: boolean;
    stickyModelDbId?: number;
    reason?: string;
  };
  eligibleCandidatesCount: number;
  totalCandidatesCount: number;
  candidates: CandidateTelemetry[];
  selectedReasonCode: SelectionReasonCode;
  explanation: {
    winnerReason: string;
    alternativeRejections: AlternativeRejection[];
  };
  fallbackAttempts: number;
  executionOutcome?: 'success' | 'error' | 'pending';
  timestamp: string;
}

const TELEMETRY_BUFFER_MAX = 500;
const telemetryBuffer: RoutingTelemetry[] = [];

export function recordRoutingTelemetry(telemetry: RoutingTelemetry): void {
  const sanitized: RoutingTelemetry = JSON.parse(JSON.stringify(telemetry));

  telemetryBuffer.unshift(sanitized);
  if (telemetryBuffer.length > TELEMETRY_BUFFER_MAX) {
    telemetryBuffer.pop();
  }
}

export function getRecentRoutingTelemetry(limit = 50): RoutingTelemetry[] {
  return telemetryBuffer.slice(0, limit);
}

export function getTelemetryForRequest(requestId: string): RoutingTelemetry | undefined {
  return telemetryBuffer.find(t => t.requestId === requestId);
}

export function generateRoutingExplanation(
  winner: CandidateTelemetry | undefined,
  candidates: CandidateTelemetry[],
  workload: string,
  selectedReasonCode: SelectionReasonCode,
  isSticky = false
): { winnerReason: string; alternativeRejections: AlternativeRejection[] } {
  if (!winner) {
    return {
      winnerReason: 'No candidate models available in catalog or fallback chain.',
      alternativeRejections: [],
    };
  }

  let winnerReason = '';

  if (selectedReasonCode === 'sticky_session' || isSticky) {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) to preserve sticky conversation session affinity.`;
  } else if (selectedReasonCode === 'only_eligible_model') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) as the single eligible candidate satisfying request capability requirements.`;
  } else if (selectedReasonCode === 'highest_agentic_score') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) for top agentic performance score (${winner.score.toFixed(3)}) with tool calling support.`;
  } else if (selectedReasonCode === 'highest_coding_score') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) for top coding performance score (${winner.score.toFixed(3)}).`;
  } else if (selectedReasonCode === 'exploration') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) via Thompson sampling exploration floor to gather performance evidence.`;
  } else if (selectedReasonCode === 'fallback') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) as a qualified fallback after higher-ranked candidates experienced errors or rate limits.`;
  } else if (selectedReasonCode === 'quota_protection') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) with healthy quota headroom while higher candidates were throttled.`;
  } else if (selectedReasonCode === 'rate_limit_protection') {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) because alternatives were on active rate limit cooldowns.`;
  } else {
    winnerReason = `Selected ${winner.displayName} (${winner.platform}/${winner.modelId}) for achieving the highest composite score (${winner.score.toFixed(3)}) under ${workload} workload.`;
  }

  const alternativeRejections: AlternativeRejection[] = candidates
    .filter(c => !(c.modelDbId === winner.modelDbId && c.platform === winner.platform))
    .slice(0, 10)
    .map(c => {
      let reasonCode = 'lower_score';
      let details = `Scored ${c.score.toFixed(3)} compared to winner ${winner.score.toFixed(3)}.`;

      if (!c.eligible) {
        if (c.rejectionReason?.includes('vision')) {
          reasonCode = 'lacks_vision_capability';
        } else if (c.rejectionReason?.includes('tool')) {
          reasonCode = 'lacks_tool_capability';
        } else if (c.rejectionReason?.includes('cooldown')) {
          reasonCode = 'rate_limit_protection';
        } else if (c.rejectionReason?.includes('headroom') || c.rejectionReason?.includes('tpm') || c.rejectionReason?.includes('rpm')) {
          reasonCode = 'quota_protection';
        } else {
          reasonCode = 'ineligible';
        }
        details = c.rejectionReason || 'Candidate did not meet eligibility constraints.';
      } else if (c.rateLimitPenalty > 0) {
        reasonCode = 'rate_limit_protection';
        details = `Demoted due to rate limit penalty level ${c.rateLimitPenalty}.`;
      } else if (c.headroom < 0.2) {
        reasonCode = 'quota_protection';
        details = `Demoted due to low remaining quota headroom (${(c.headroom * 100).toFixed(1)}%).`;
      }

      return {
        model: c.modelId,
        platform: c.platform,
        reasonCode,
        details,
      };
    });

  return {
    winnerReason,
    alternativeRejections,
  };
}
