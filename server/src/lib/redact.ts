const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/freellmapi-[A-Za-z0-9_-]+/gi, 'freellmapi-[REDACTED]'],
  [/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/gsk_[A-Za-z0-9_-]{12,}/g, 'gsk-[REDACTED]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, 'AIza[REDACTED]'],
  [/ghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [REDACTED]'],
  [/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s,}]{8,}/gi, '$1=[REDACTED]'],
  [/([?&](?:key|api_key|token|secret)=)[^&\s"']{8,}/gi, '$1[REDACTED]'],
]

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
  }

  if (value instanceof Error) {
    const clone = new Error(redactValue(value.message) as string)
    clone.name = value.name
    clone.stack = typeof value.stack === 'string' ? (redactValue(value.stack) as string) : value.stack
    return clone
  }

  return value
}

export function installLogRedaction(): void {
  const methods: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error']

  for (const method of methods) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => original(...args.map(redactValue))
  }
}
