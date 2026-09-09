import { describe, it, expect } from 'vitest';
import {
  classifyWorkload,
  parseModelWorkloadProfile,
  parseWorkloadHeader,
} from '../../lib/workload-classifier.js';

describe('Workload Classifier', () => {
  it('parses model workload profiles correctly', () => {
    expect(parseModelWorkloadProfile('auto/chat')).toBe('chat');
    expect(parseModelWorkloadProfile('auto:coding')).toBe('coding');
    expect(parseModelWorkloadProfile('auto/agentic')).toBe('agentic');
    expect(parseModelWorkloadProfile('auto-vision')).toBe('vision');
    expect(parseModelWorkloadProfile('gpt-4o')).toBeNull();
    expect(parseModelWorkloadProfile('auto')).toBeNull();
  });

  it('parses explicit workload headers', () => {
    const req = { headers: { 'x-workload': 'agentic' } } as any;
    expect(parseWorkloadHeader(req)).toBe('agentic');

    const reqTask = { headers: { 'x-freellm-task-type': 'coding' } } as any;
    expect(parseWorkloadHeader(reqTask)).toBe('coding');
  });

  it('classifies vision workload when image content is present', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'What is in this picture?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,123' } },
        ],
      },
    ];

    const result = classifyWorkload(undefined, messages);
    expect(result.workload).toBe('vision');
    expect(result.source).toBe('detected_signals');
  });

  it('classifies agentic workload when tools and tool choice are present', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'execute_command', description: 'Run shell command' },
      },
    ];

    const messages = [
      { role: 'system' as const, content: 'You are Claude Code assistant.' },
      { role: 'user' as const, content: 'Run pytest for me.' },
    ];

    const result = classifyWorkload(undefined, messages, tools, 'auto');
    expect(result.workload).toBe('agentic');
    expect(result.signals).toContain('agentic_system_prompt_detected');
  });

  it('classifies coding workload when code blocks or stack traces are detected', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Fix this code:\n```typescript\nconst x: number = 5;\n```',
      },
    ];

    const result = classifyWorkload(undefined, messages);
    expect(result.workload).toBe('coding');
    expect(result.source).toBe('detected_signals');
  });

  it('defaults to chat workload when no specific signals match', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello, how are you today?' },
    ];

    const result = classifyWorkload(undefined, messages);
    expect(result.workload).toBe('chat');
  });
});
