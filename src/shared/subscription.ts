import type { CodexStatus } from './codex'
import type { ClaudeStatus } from './claude'

export type SubscriptionProvider = 'codex' | 'claude'
export interface SubscriptionStatus { codex: CodexStatus; claude: ClaudeStatus }
export interface AiProviderStatus {
  hasTinyfishApiKey: boolean
  tinyfishApiKeySource: 'env' | 'saved' | 'none'
  hasBraveApiKey: boolean
  braveApiKeySource: 'env' | 'saved' | 'none'
  webSearchEnabled: boolean
  webSearchMaxResults: number
}
export function parseSubscriptionModel(value: string): { provider: SubscriptionProvider; model: string } {
  const match = /^(codex|claude):(.+)$/.exec(value)
  if (!match) throw new Error('Settings에서 GPT 또는 Claude 구독 모델을 선택해 주세요.')
  return { provider: match[1] as SubscriptionProvider, model: match[2] === 'default' ? '' : match[2] }
}
export function modelLabel(value: string): string {
  if (value === 'codex:default') return 'GPT · Default'
  if (value === 'claude:default') return 'Claude · Default'
  return value.replace(/^codex:/, 'GPT · ').replace(/^claude:/, 'Claude · ')
}
