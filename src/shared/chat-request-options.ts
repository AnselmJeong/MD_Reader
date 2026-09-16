export const THINKING_LEVELS = ['none', 'low', 'medium', 'high'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

export interface ChatRequestOptions {
  webSearch?: boolean
  thinkingLevel?: ThinkingLevel
}

export function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  return THINKING_LEVELS.find(level => level === value) ?? 'none'
}

export function effectiveThinkingLevel(model: string, value: unknown): ThinkingLevel {
  const level = normalizeThinkingLevel(value)
  // Ollama documents GPT-OSS as requiring low/medium/high; false is ignored.
  return level === 'none' && /(?:^|\/)gpt-oss(?=[:\-]|$)/i.test(model) ? 'low' : level
}
