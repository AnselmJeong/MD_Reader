import { SimpleStore } from './simple-store'
import type { AiProviderStatus } from '../shared/subscription'
export type { AiProviderStatus } from '../shared/subscription'

interface AiProviderSettings {
  tinyfishApiKey: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
}
export type AiProviderSettingsUpdate = Partial<AiProviderSettings>
const store = new SimpleStore<AiProviderSettings>('md-reader-ai-provider-settings', {
  tinyfishApiKey: '', webSearchEnabled: true, webSearchMaxResults: 5
})
// Remove obsolete credentials from this app's settings, retaining search preferences.
store.deleteLegacyKeys(['ollamaApiKey', 'ollamaBaseUrl'])
export function getAiProviderConfig(): AiProviderSettings {
  return {
    tinyfishApiKey: process.env.TINYFISH_API_KEY?.trim() || store.get('tinyfishApiKey').trim(),
    webSearchEnabled: store.get('webSearchEnabled'),
    webSearchMaxResults: Math.min(Math.max(Number(store.get('webSearchMaxResults')) || 5, 1), 10)
  }
}
export function getAiProviderStatus(): AiProviderStatus {
  const config = getAiProviderConfig()
  return {
    hasTinyfishApiKey: Boolean(config.tinyfishApiKey),
    tinyfishApiKeySource: process.env.TINYFISH_API_KEY?.trim() ? 'env' : store.get('tinyfishApiKey').trim() ? 'saved' : 'none',
    webSearchEnabled: config.webSearchEnabled,
    webSearchMaxResults: config.webSearchMaxResults
  }
}
export function updateAiProviderSettings(partial: AiProviderSettingsUpdate): AiProviderStatus {
  if (typeof partial.tinyfishApiKey === 'string' && partial.tinyfishApiKey.trim()) store.set('tinyfishApiKey', partial.tinyfishApiKey.trim())
  if (typeof partial.webSearchEnabled === 'boolean') store.set('webSearchEnabled', partial.webSearchEnabled)
  if (typeof partial.webSearchMaxResults === 'number' && Number.isFinite(partial.webSearchMaxResults)) store.set('webSearchMaxResults', Math.min(Math.max(Math.round(partial.webSearchMaxResults), 1), 10))
  return getAiProviderStatus()
}
