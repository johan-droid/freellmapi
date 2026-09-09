import type { Request } from 'express';
import type { ChatMessage, ChatToolDefinition, ChatToolChoice } from '@freellmapi/shared/types.js';
import { contentToString, messageHasImage } from './content.js';

export type WorkloadType = 'chat' | 'coding' | 'agentic' | 'vision';

export interface WorkloadClassification {
  workload: WorkloadType;
  source: 'explicit_header' | 'requested_model' | 'detected_signals';
  confidence: number;
  signals: string[];
}

const MAX_SCAN_CHARS = 4000;

// Code syntax markers
const CODE_MARKERS: readonly RegExp[] = [
  /```/,
  /^[ \t]*\$[ \t]+[a-z][\w./-]*(?=[ \t]|$)/m,
  /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(/,
  /\bdef\s+[A-Za-z_]\w*\s*\(/,
  /^[ \t]*class\s+[A-Za-z_$][\w$]*\s*[({:]/m,
  /\bclass\s+[A-Za-z_$][\w$]*\s+extends\s+[A-Za-z_$][\w$]*/,
  /\bimport\s*\{/,
  /\bimport\s[^\n;]{0,200}?\bfrom\s*['"][^'"\n]+['"]/,
  /^[ \t]*from\s+[A-Za-z_.][\w.]*\s+import\s+\S/m,
  /\brequire\s*\(\s*['"]/,
  /^[ \t]*#\s*include\s*[<"]/m,
  /\b[\w./-]+\.(?:[jt]sx?|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|cpp|cc|hpp|sh|sql|css|scss|html|vue|svelte|ya?ml|json|toml)\s*:\s*\d+/,
  /\b[A-Za-z_][\w./-]*\.[ch]\s*:\s*\d+/,
  /^\s*at\s+\S.*\(.*:\d+:\d+\)/m,
  /^\s*File\s+"[^"\n]+",\s*line\s+\d+/m,
  /\bTraceback\s+\(most recent call last\)/,
  /diff --git a\/.* b\//,
  /@@ -\d+,\d+ \+\d+,\d+ @@/,
];

// Agentic/tool harness system prompt & content keywords
const AGENTIC_SYSTEM_MARKERS: readonly RegExp[] = [
  /claude[\s-_]?code/i,
  /cline/i,
  /roo[\s-_]?code/i,
  /continue[\s-_]?dev/i,
  /cursor/i,
  /aionui/i,
  /mcp[\s-_]?server/i,
  /tool[\s-_]?use/i,
  /agent/i,
  /bash[\s-_]?executor/i,
  /read[\s-_]?file/i,
  /write[\s-_]?file/i,
  /edit[\s-_]?file/i,
  /execute[\s-_]?command/i,
];

export function parseModelWorkloadProfile(requestedModel?: string): WorkloadType | null {
  if (!requestedModel) return null;
  const lower = requestedModel.trim().toLowerCase();

  const match = lower.match(/^auto[:/_-](chat|coding|agentic|vision)$/);
  if (match) {
    return match[1] as WorkloadType;
  }
  return null;
}

export function parseWorkloadHeader(req?: Request): WorkloadType | null {
  if (!req || !req.headers) return null;

  const rawHeader =
    req.headers['x-workload'] ??
    req.headers['x-freellm-workload'] ??
    req.headers['x-task-type'] ??
    req.headers['x-freellm-task-type'];

  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const trimmed = value?.trim().toLowerCase();

  if (trimmed === 'agentic' || trimmed === 'coding' || trimmed === 'vision' || trimmed === 'chat') {
    return trimmed;
  }
  return null;
}

export function classifyWorkload(
  req?: Request,
  messages?: ChatMessage[],
  tools?: ChatToolDefinition[],
  toolChoice?: ChatToolChoice,
  requestedModel?: string
): WorkloadClassification {
  const signals: string[] = [];

  const headerWorkload = parseWorkloadHeader(req);
  if (headerWorkload) {
    signals.push(`explicit_header:${headerWorkload}`);
    return {
      workload: headerWorkload,
      source: 'explicit_header',
      confidence: 1.0,
      signals,
    };
  }

  const modelWorkload = parseModelWorkloadProfile(requestedModel);
  if (modelWorkload) {
    signals.push(`requested_model:${modelWorkload}`);
    return {
      workload: modelWorkload,
      source: 'requested_model',
      confidence: 1.0,
      signals,
    };
  }

  if (messages && messageHasImage(messages)) {
    signals.push('has_vision_inputs');
    return {
      workload: 'vision',
      source: 'detected_signals',
      confidence: 1.0,
      signals,
    };
  }

  let agenticScore = 0;

  if (Array.isArray(tools) && tools.length > 0) {
    signals.push(`has_tools:${tools.length}`);
    agenticScore += 2;
  }

  if (toolChoice && toolChoice !== 'none') {
    signals.push(`has_tool_choice:${typeof toolChoice === 'string' ? toolChoice : 'function'}`);
    agenticScore += 1;
  }

  if (messages && Array.isArray(messages)) {
    let hasToolTurn = false;
    let systemMatch = false;

    for (const m of messages) {
      if (m.role === 'tool' || (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)) {
        hasToolTurn = true;
      }
      if (m.role === 'system') {
        const text = contentToString(m.content);
        for (const re of AGENTIC_SYSTEM_MARKERS) {
          if (re.test(text)) {
            systemMatch = true;
            break;
          }
        }
      }
    }

    if (hasToolTurn) {
      signals.push('has_tool_interaction_history');
      agenticScore += 2;
    }

    if (systemMatch) {
      signals.push('agentic_system_prompt_detected');
      agenticScore += 1;
    }
  }

  if (agenticScore >= 2) {
    return {
      workload: 'agentic',
      source: 'detected_signals',
      confidence: Math.min(1.0, 0.6 + agenticScore * 0.15),
      signals,
    };
  }

  let isCoding = false;
  if (messages && Array.isArray(messages)) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      const text = contentToString(lastUser.content).slice(0, MAX_SCAN_CHARS);
      for (const marker of CODE_MARKERS) {
        if (marker.test(text)) {
          isCoding = true;
          signals.push(`code_marker:${marker.source.slice(0, 30)}`);
          break;
        }
      }
    }
  }

  if (isCoding) {
    return {
      workload: 'coding',
      source: 'detected_signals',
      confidence: 0.85,
      signals,
    };
  }

  signals.push('default_chat');
  return {
    workload: 'chat',
    source: 'detected_signals',
    confidence: 0.7,
    signals,
  };
}
