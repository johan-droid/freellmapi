import type { ChatMessage } from '@freellmapi/shared/types.js';
import { contentToString } from '../lib/content.js';

export interface RequestIntent {
  coding: boolean;
  agentic: boolean;
}

const CODING_TEXT_PATTERNS = [
  /\bclaude code\b/i,
  /\bcodex\b/i,
  /\bapply_patch\b/i,
  /\bstack trace\b/i,
  /\btraceback\b/i,
  /\brefactor\b/i,
  /\bdebug\b/i,
  /\bfix\b/i,
  /\bpatch\b/i,
  /\bdiff\b/i,
  /```/,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bpython\b/i,
  /\breact\b/i,
  /\bnext\.?js\b/i,
  /\bnode\.?js\b/i,
  /\bgit\b/i,
  /\bterminal\b/i,
  /\bshell\b/i,
  /\bworkspace\b/i,
  /\brepository\b/i,
];

const AGENT_TOOL_NAMES = new Set([
  'apply_patch',
  'local_shell',
  'shell',
  'terminal',
  'bash',
  'exec',
  'read_file',
  'write_file',
  'edit_file',
  'replace_file',
  'filesystem',
  'file',
  'web_search',
]);

type ToolLike = { type?: string; name?: string; function?: { name?: string } };

function normalizeToolName(tool: ToolLike): string {
  return (tool.function?.name ?? tool.name ?? '').trim().toLowerCase();
}

function collectMessageText(messages: ChatMessage[]): string {
  return messages.map(m => contentToString(m.content)).join('\n\n');
}

export function detectRequestIntent(messages: ChatMessage[], tools?: ToolLike[]): RequestIntent {
  const text = collectMessageText(messages);
  const hasTools = (tools?.length ?? 0) > 0;
  const hasBuiltInTool = tools?.some(tool => tool.type != null && tool.type !== 'function') ?? false;
  const hasAgentToolName = tools?.some(tool => AGENT_TOOL_NAMES.has(normalizeToolName(tool))) ?? false;
  const hasCodingText = CODING_TEXT_PATTERNS.some(pattern => pattern.test(text));

  const coding = hasBuiltInTool || hasAgentToolName || hasCodingText;
  return {
    coding,
    agentic: hasTools || coding,
  };
}
