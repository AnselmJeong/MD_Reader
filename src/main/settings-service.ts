import { SimpleStore } from './simple-store'

interface AppSettings {
  theme: 'light' | 'sepia' | 'dark'
  fontSize: number
  aiSidebarFontSize: number
  lineHeight: number
  contentWidth: number
  readerFontFamily: string
  ollamaModel: string
  systemPrompt: string
  ttsVoice: 'Ava' | 'Christopher'
}

const store = new SimpleStore<AppSettings>('md-reader-settings', {
  theme: 'light',
  fontSize: 17,
  aiSidebarFontSize: 14,
  lineHeight: 1.75,
  contentWidth: 64,
  readerFontFamily: '',
  ollamaModel: '',
  ttsVoice: 'Christopher',
  systemPrompt: 'You are a careful academic reading assistant. Answer in Korean.\n\nUse the provided document context first. When web sources are provided, use them to verify current or external factual claims and cite them with [S1], [S2] markers. If the provided document or sources do not support a claim, say so clearly instead of guessing.\n\nKeep answers precise, distinguish document evidence from web evidence, and avoid inventing citations.'
})

export function getSettings(key?: string): unknown {
  if (key) {
    return store.get(key as keyof AppSettings)
  }
  return store.getAll()
}

export function setSettings(key: string, value: unknown): void {
  store.set(key as keyof AppSettings, value as never)
}
