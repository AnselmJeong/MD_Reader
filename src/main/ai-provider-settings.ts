import { SimpleStore } from './simple-store'

interface AiProviderSettings {
  tinyfishApiKey: string
  ollamaApiKey: string
  ollamaBaseUrl: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
}

export interface AiProviderStatus {
  hasTinyfishApiKey: boolean
  tinyfishApiKeySource: 'env' | 'saved' | 'none'
  hasOllamaApiKey: boolean
  ollamaBaseUrl: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
  apiKeySource: 'env' | 'saved' | 'none'
}

export interface AiProviderSettingsUpdate {
  tinyfishApiKey?: string
  ollamaApiKey?: string
  ollamaBaseUrl?: string
  webSearchEnabled?: boolean
  webSearchMaxResults?: number
}

const DEFAULTS: AiProviderSettings = {
  tinyfishApiKey: '',
  ollamaApiKey: '',
  ollamaBaseUrl: 'https://ollama.com/v1',
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
    tinyfishApiKey: process.env.TINYFISH_API_KEY?.trim() || store.get('tinyfishApiKey').trim(),
    ollamaApiKey: getOllamaApiKey(),
    ollamaBaseUrl: normalizeBaseUrl(store.get('ollamaBaseUrl'), DEFAULTS.ollamaBaseUrl),
    webSearchEnabled: store.get('webSearchEnabled'),
    webSearchMaxResults: Math.min(Math.max(Number(store.get('webSearchMaxResults')) || 5, 1), 10)
  }
}

export function getAiProviderStatus(): AiProviderStatus {
  const envKey = Boolean(process.env.OLLAMA_API_KEY?.trim())
  const savedKey = Boolean(store.get('ollamaApiKey').trim())
  const config = getAiProviderConfig()

  return {
    hasTinyfishApiKey: Boolean(config.tinyfishApiKey),
    tinyfishApiKeySource: process.env.TINYFISH_API_KEY?.trim() ? 'env' : store.get('tinyfishApiKey').trim() ? 'saved' : 'none',
    hasOllamaApiKey: envKey || savedKey,
    ollamaBaseUrl: config.ollamaBaseUrl,
    webSearchEnabled: config.webSearchEnabled,
    webSearchMaxResults: config.webSearchMaxResults,
    apiKeySource: envKey ? 'env' : savedKey ? 'saved' : 'none'
  }
}

export function updateAiProviderSettings(partial: AiProviderSettingsUpdate): AiProviderStatus {
  if (typeof partial.tinyfishApiKey === 'string' && partial.tinyfishApiKey.trim()) {
    store.set('tinyfishApiKey', partial.tinyfishApiKey.trim())
  }
  if (typeof partial.ollamaApiKey === 'string' && partial.ollamaApiKey.trim()) {
    store.set('ollamaApiKey', partial.ollamaApiKey.trim())
  }
  if (typeof partial.ollamaBaseUrl === 'string') {
    store.set('ollamaBaseUrl', normalizeBaseUrl(partial.ollamaBaseUrl, DEFAULTS.ollamaBaseUrl))
  }
  if (typeof partial.webSearchEnabled === 'boolean') {
    store.set('webSearchEnabled', partial.webSearchEnabled)
  }
  if (typeof partial.webSearchMaxResults === 'number' && Number.isFinite(partial.webSearchMaxResults)) {
    store.set('webSearchMaxResults', Math.min(Math.max(Math.round(partial.webSearchMaxResults), 1), 10))
  }

  return getAiProviderStatus()
}
