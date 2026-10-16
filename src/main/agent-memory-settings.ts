import { SimpleStore } from './simple-store'
import { ensureHindsightBank } from './hindsight-client'

export interface AgentMemorySettings {
  enabled: boolean
  extractionEnabled: boolean
  runtimeInjectionEnabled: boolean
  hindsightBaseUrl: string
  hindsightApiKey: string
  hindsightBankId: string
  extractorModel: string
  soulAutoApply: boolean
  minConfidenceToApplyUser: number
  minConfidenceToStoreInsight: number
}

const store = new SimpleStore<AgentMemorySettings>('agent-memory-settings', {
  enabled: true,
  extractionEnabled: true,
  runtimeInjectionEnabled: true,
  hindsightBaseUrl: 'https://hindsight.ecoplay.cloud',
  hindsightApiKey: '',
  hindsightBankId: 'MD-reader',
  extractorModel: '',
  soulAutoApply: false,
  minConfidenceToApplyUser: 0.72,
  minConfidenceToStoreInsight: 0.68
})
// Never forward credentials or server addresses from the retired provider.
store.deleteLegacyKeys(['mem0BaseUrl', 'mem0ApiKey', 'mem0AuthMode', 'userId'])
if (store.get('extractorModel') && !/^(codex|claude):.+$/.test(store.get('extractorModel'))) {
  store.set('extractorModel', '')
}

export function normalizeHindsightUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Hindsight server must be an HTTP(S) URL without credentials, query, or fragment.')
  }
  if (/\/dashboard(?:\/|$)/.test(url.pathname)) throw new Error('서버 주소는 /dashboard 없이 입력하세요. 예: https://hindsight.ecoplay.cloud')
  return url.toString().replace(/\/+$/, '')
}

export function getAgentMemorySettings(): AgentMemorySettings {
  return effectiveSettings(store.getAll())
}

function effectiveSettings(settings: AgentMemorySettings): AgentMemorySettings {
  return {
    ...settings,
    hindsightBaseUrl: process.env.MD_READER_HINDSIGHT_BASE_URL || settings.hindsightBaseUrl,
    hindsightApiKey: process.env.MD_READER_HINDSIGHT_API_KEY || settings.hindsightApiKey,
    hindsightBankId: process.env.MD_READER_HINDSIGHT_BANK_ID || settings.hindsightBankId,
    extractorModel: process.env.MD_READER_MEMORY_EXTRACTOR_MODEL || settings.extractorModel
  }
}

function prepareAgentMemorySettings(partial: Partial<AgentMemorySettings>): AgentMemorySettings {
  const next = store.getAll()
  for (const key of ['enabled', 'extractionEnabled', 'runtimeInjectionEnabled'] as const) {
    if (typeof partial[key] === 'boolean') next[key] = partial[key]
  }
  if (typeof partial.hindsightBaseUrl === 'string') next.hindsightBaseUrl = normalizeHindsightUrl(partial.hindsightBaseUrl)
  if (typeof partial.hindsightBankId === 'string') {
    const id = partial.hindsightBankId.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('Memory bank ID must contain letters, numbers, dots, underscores, or hyphens (1–128 characters).')
    next.hindsightBankId = id
  }
  // Omitted means keep; an explicit empty string clears the saved key.
  if (typeof partial.hindsightApiKey === 'string') next.hindsightApiKey = partial.hindsightApiKey.trim()
  if (typeof partial.extractorModel === 'string') next.extractorModel = partial.extractorModel.trim()
  next.soulAutoApply = false
  return next
}

function saveAgentMemorySettings(next: AgentMemorySettings): AgentMemorySettings {
  for (const [key, value] of Object.entries(next)) store.set(key as keyof AgentMemorySettings, value)
  return getAgentMemorySettings()
}

export function updateAgentMemorySettings(partial: Partial<AgentMemorySettings>): AgentMemorySettings {
  return saveAgentMemorySettings(prepareAgentMemorySettings(partial))
}

export async function connectAgentMemorySettings(partial: Partial<AgentMemorySettings>): Promise<AgentMemorySettings> {
  const next = prepareAgentMemorySettings(partial)
  // Keep the working destination and credentials if connection validation fails.
  // Disabling memory must remain possible while the server is offline.
  if (next.enabled) await ensureHindsightBank(effectiveSettings(next))
  return saveAgentMemorySettings(next)
}
