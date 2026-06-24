import { SimpleStore } from './simple-store'

export type Mem0AuthMode = 'x-api-key' | 'bearer' | 'none'

export interface AgentMemorySettings {
  enabled: boolean
  extractionEnabled: boolean
  runtimeInjectionEnabled: boolean
  mem0BaseUrl: string
  mem0ApiKey: string
  mem0AuthMode: Mem0AuthMode
  userId: string
  extractorModel: string
  soulAutoApply: boolean
  minConfidenceToApplyUser: number
  minConfidenceToStoreInsight: number
}

const store = new SimpleStore<AgentMemorySettings>('agent-memory-settings', {
  enabled: true,
  extractionEnabled: true,
  runtimeInjectionEnabled: true,
  mem0BaseUrl: 'http://127.0.0.1:8888',
  mem0ApiKey: '',
  mem0AuthMode: 'x-api-key',
  userId: 'md-reader-user',
  extractorModel: '',
  soulAutoApply: false,
  minConfidenceToApplyUser: 0.72,
  minConfidenceToStoreInsight: 0.68
})

export function getAgentMemorySettings(): AgentMemorySettings {
  const settings = store.getAll()
  return {
    ...settings,
    mem0BaseUrl: process.env.MEM0_BASE_URL || settings.mem0BaseUrl,
    mem0ApiKey: process.env.MEM0_API_KEY || settings.mem0ApiKey,
    mem0AuthMode: (process.env.MEM0_AUTH_MODE as Mem0AuthMode | undefined) || settings.mem0AuthMode,
    userId: process.env.MEM0_USER_ID || settings.userId,
    extractorModel: process.env.MD_READER_MEMORY_EXTRACTOR_MODEL || settings.extractorModel
  }
}

export function setAgentMemorySetting<K extends keyof AgentMemorySettings>(key: K, value: AgentMemorySettings[K]): void {
  store.set(key, value)
}

export function updateAgentMemorySettings(partial: Partial<AgentMemorySettings>): AgentMemorySettings {
  const current = store.getAll()
  const nextMem0ApiKey = typeof partial.mem0ApiKey === 'string' && partial.mem0ApiKey.trim()
    ? partial.mem0ApiKey.trim()
    : current.mem0ApiKey
  const next: AgentMemorySettings = {
    ...current,
    ...partial,
    mem0ApiKey: nextMem0ApiKey,
    enabled: typeof partial.enabled === 'boolean' ? partial.enabled : current.enabled,
    extractionEnabled: typeof partial.extractionEnabled === 'boolean' ? partial.extractionEnabled : current.extractionEnabled,
    runtimeInjectionEnabled: typeof partial.runtimeInjectionEnabled === 'boolean' ? partial.runtimeInjectionEnabled : current.runtimeInjectionEnabled,
    soulAutoApply: false,
    minConfidenceToApplyUser: typeof partial.minConfidenceToApplyUser === 'number'
      ? partial.minConfidenceToApplyUser
      : current.minConfidenceToApplyUser,
    minConfidenceToStoreInsight: typeof partial.minConfidenceToStoreInsight === 'number'
      ? partial.minConfidenceToStoreInsight
      : current.minConfidenceToStoreInsight
  }

  for (const [key, value] of Object.entries(next) as Array<[keyof AgentMemorySettings, AgentMemorySettings[keyof AgentMemorySettings]]>) {
    store.set(key, value as never)
  }
  return getAgentMemorySettings()
}
