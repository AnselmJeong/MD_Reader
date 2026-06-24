import { SimpleStore } from './simple-store'

interface AiProviderSettings {
  ollamaApiKey: string
  ollamaBaseUrl: string
  ollamaSearchBaseUrl: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
}

export interface AiProviderStatus {
  hasOllamaApiKey: boolean
  ollamaBaseUrl: string
  ollamaSearchBaseUrl: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
  apiKeySource: 'env' | 'saved' | 'none'
}

export interface AiProviderSettingsUpdate {
  ollamaApiKey?: string
  ollamaBaseUrl?: string
  ollamaSearchBaseUrl?: string
  webSearchEnabled?: boolean
  webSearchMaxResults?: number
}

const DEFAULTS: AiProviderSettings = {
  ollamaApiKey: '',
  ollamaBaseUrl: 'https://ollama.com/v1',
  ollamaSearchBaseUrl: 'https://ollama.com/api',
  webSearchEnabled: true,
  webSearchMaxResults: 5
}

const store = new SimpleStore<AiProviderSettings>('md-reader-ai-provider-settings', DEFAULTS)

function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.replace(/\/+$/, '')
}

export function getOllamaApiKey(): string {
  return process.env.OLLAMA_API_KEY?.trim() || store.get('ollamaApiKey').trim()
}

export function getAiProviderConfig(): AiProviderSettings {
  return {
    ollamaApiKey: getOllamaApiKey(),
    ollamaBaseUrl: normalizeBaseUrl(store.get('ollamaBaseUrl'), DEFAULTS.ollamaBaseUrl),
    ollamaSearchBaseUrl: normalizeBaseUrl(store.get('ollamaSearchBaseUrl'), DEFAULTS.ollamaSearchBaseUrl),
    webSearchEnabled: store.get('webSearchEnabled'),
    webSearchMaxResults: Math.min(Math.max(Number(store.get('webSearchMaxResults')) || 5, 1), 10)
  }
}

export function getAiProviderStatus(): AiProviderStatus {
  const envKey = Boolean(process.env.OLLAMA_API_KEY?.trim())
  const savedKey = Boolean(store.get('ollamaApiKey').trim())
  const config = getAiProviderConfig()

  return {
    hasOllamaApiKey: envKey || savedKey,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaSearchBaseUrl: config.ollamaSearchBaseUrl,
    webSearchEnabled: config.webSearchEnabled,
    webSearchMaxResults: config.webSearchMaxResults,
    apiKeySource: envKey ? 'env' : savedKey ? 'saved' : 'none'
  }
}

export function updateAiProviderSettings(partial: AiProviderSettingsUpdate): AiProviderStatus {
  if (typeof partial.ollamaApiKey === 'string' && partial.ollamaApiKey.trim()) {
    store.set('ollamaApiKey', partial.ollamaApiKey.trim())
  }
  if (typeof partial.ollamaBaseUrl === 'string') {
    store.set('ollamaBaseUrl', normalizeBaseUrl(partial.ollamaBaseUrl, DEFAULTS.ollamaBaseUrl))
  }
  if (typeof partial.ollamaSearchBaseUrl === 'string') {
    store.set('ollamaSearchBaseUrl', normalizeBaseUrl(partial.ollamaSearchBaseUrl, DEFAULTS.ollamaSearchBaseUrl))
  }
  if (typeof partial.webSearchEnabled === 'boolean') {
    store.set('webSearchEnabled', partial.webSearchEnabled)
  }
  if (typeof partial.webSearchMaxResults === 'number' && Number.isFinite(partial.webSearchMaxResults)) {
    store.set('webSearchMaxResults', Math.min(Math.max(Math.round(partial.webSearchMaxResults), 1), 10))
  }

  return getAiProviderStatus()
}
