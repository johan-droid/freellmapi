import type { ChatMessage } from '@freellmapi/shared/types.js';
import { contentToString, contentHasImage } from '../../lib/content.js';

export function estimateTokensFromMessages(messages: ChatMessage[], expectedOutputTokens: number): { input: number; total: number } {
  const inputChars = messages.reduce((sum, m) => sum + contentToString(m.content).length, 0);
  const toolChars = messages.some(m => m.tool_calls) ? 800 : 0;
  const inputTokens = Math.ceil((inputChars + toolChars) / 4);
  const total = inputTokens + expectedOutputTokens;
  return { input: inputTokens, total };
}

export function hasToolsInRequest(messages: ChatMessage[], tools?: unknown): boolean {
  if (Array.isArray(tools) && tools.length > 0) return true;
  // also check if any message contains tool_calls (history)
  return messages.some(m => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
}

export function hasVisionInRequest(messages: ChatMessage[]): boolean {
  return messages.some(m => contentHasImage(m.content));
}
