import type { AutoCandidate } from './types.js';

export type TaskKind = 'coding' | 'review' | 'planning' | 'analysis' | 'debugging' | 'documentation' | 'chat' | 'reasoning' | 'vision';

function haystack(c: AutoCandidate): string {
  return `${c.provider} ${c.model} ${c.displayName}`.toLowerCase();
}

const taskMatchers: Record<TaskKind, (c: AutoCandidate) => number> = {
  coding: (c) => {
    const h = haystack(c);
    let score = 0.5;
    if (h.includes('coder') || h.includes('codestral') || h.includes('devstral') || h.includes('qwen3') || h.includes('glm-') || h.includes('nemotron') || h.includes('deepseek-v3') || h.includes('minimax-m3') || h.includes('opencode')) score = 0.9;
    else if (c.supportsTools) score = 0.7;
    if (h.includes('flash-lite') || h.includes('mini') || h.includes('haiku')) score -= 0.2;
    return Math.max(0, Math.min(1, score));
  },
  review: (c) => {
    const h = haystack(c);
    if (h.includes('coder') || h.includes('qwen3')) return 0.85;
    return 0.5;
  },
  planning: (c) => {
    const h = haystack(c);
    if (h.includes('pro') || h.includes('ultra') || h.includes('gemini-3')) return 0.8;
    return 0.5;
  },
  analysis: (c) => taskMatchers.planning(c),
  debugging: (c) => taskMatchers.coding(c),
  documentation: (c) => {
    const h = haystack(c);
    if (h.includes('chat') || h.includes('instruct')) return 0.75;
    return 0.5;
  },
  chat: (c) => {
    const h = haystack(c);
    if (h.includes('flash') || h.includes('mini') || h.includes('haiku') || h.includes('chat') || h.includes('instruct')) return 0.85;
    return 0.55;
  },
  reasoning: (c) => {
    const h = haystack(c);
    if (h.includes('reasoning') || h.includes('deepseek-v4') || h.includes('command-a') || h.includes('kimi-k2') || h.includes('nemotron-3-super') || h.includes('glm-4.7') || h.includes('gpt-5') || c.supportsReasoning) return 0.9;
    if (h.includes('pro') || h.includes('ultra') || c.tier === 'pro' || c.tier === 'ultra') return 0.7;
    return 0.4;
  },
  vision: (c) => {
    if (c.supportsVision) return 0.95;
    const h = haystack(c);
    if (h.includes('vision') || h.includes('scout') || h.includes('4o') || h.includes('gemini')) return 0.7;
    return 0.1;
  },
};

export function taskFitnessFor(candidate: AutoCandidate, task: string | undefined): number {
  if (!task) return 0.5;
  const normalized = task.toLowerCase() as TaskKind;
  const fn = taskMatchers[normalized];
  if (fn) return fn(candidate);
  return 0.5;
}

export function taskFitnessFromCategory(candidate: AutoCandidate, category: string | undefined): number {
  if (!category) return 0.5;
  // category maps to task kind
  const map: Record<string, TaskKind> = {
    coding: 'coding',
    reasoning: 'reasoning',
    vision: 'vision',
    chat: 'chat',
    multimodal: 'vision',
  };
  const kind = map[category] ?? 'chat';
  return taskFitnessFor(candidate, kind);
}
