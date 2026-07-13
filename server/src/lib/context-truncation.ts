import type { ChatMessage } from '@freellmapi/shared/types.js';
import { contentToString } from './content.js';

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function truncateMessagesToFit(
  messages: ChatMessage[],
  effectiveLimit: number,
  desiredOutputTokens: number,
  toolTokens: number,
  safetyMargin: number
): { messages: ChatMessage[]; truncated: boolean; truncatedCount: number; inputTokens: number } {
  const maxAllowedInput = effectiveLimit - desiredOutputTokens - toolTokens - safetyMargin;
  let currentInputTokens = messages.reduce((sum, m) => sum + estimateTokens(contentToString(m.content)), 0);

  if (currentInputTokens <= maxAllowedInput) {
    return { messages, truncated: false, truncatedCount: 0, inputTokens: currentInputTokens };
  }

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  const protectedIndices = new Set<number>();
  messages.forEach((m, i) => {
    if (m.role === 'system' || (m as any).role === 'developer') protectedIndices.add(i);
  });
  if (lastUserIndex !== -1) protectedIndices.add(lastUserIndex);

  let lastNonToolIndex = messages.length - 1;
  while (lastNonToolIndex >= 0 && (messages[lastNonToolIndex].role === 'tool' || (messages[lastNonToolIndex] as any).role === 'function' || messages[lastNonToolIndex].tool_calls)) {
      protectedIndices.add(lastNonToolIndex);
      lastNonToolIndex--;
  }

  let truncatedCount = 0;
  const resultMessages = [...messages];

  for (let i = 0; i < resultMessages.length; i++) {
    if (currentInputTokens <= maxAllowedInput) break;
    if (protectedIndices.has(i)) continue;

    if (resultMessages[i].tool_calls || resultMessages[i].role === 'tool' || (resultMessages[i] as any).role === 'function') {
        if (resultMessages[i].role === 'user' || (resultMessages[i].role === 'assistant' && !resultMessages[i].tool_calls)) {
             const tokens = estimateTokens(contentToString(resultMessages[i].content));
             currentInputTokens -= tokens;
             resultMessages[i] = { ...resultMessages[i], _removed: true } as any;
             truncatedCount++;
        }
    } else {
        const tokens = estimateTokens(contentToString(resultMessages[i].content));
        currentInputTokens -= tokens;
        resultMessages[i] = { ...resultMessages[i], _removed: true } as any;
        truncatedCount++;
    }
  }

  const finalMessages = resultMessages.filter((m: any) => !m._removed);

  return {
    messages: finalMessages,
    truncated: truncatedCount > 0,
    truncatedCount,
    inputTokens: currentInputTokens
  };
}
