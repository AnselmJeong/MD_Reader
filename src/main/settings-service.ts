import { SimpleStore } from './simple-store'

interface AppSettings {
  theme: 'light' | 'sepia' | 'dark'
  fontSize: number
  aiSidebarFontSize: number
  lineHeight: number
  contentWidth: number
  ollamaModel: string
  systemPrompt: string
  ttsVoice: 'Ava' | 'Christopher'
}

const store = new SimpleStore<AppSettings>('md-reader-settings', {
  theme: 'light',
  fontSize: 17,
  aiSidebarFontSize: 14,
  lineHeight: 1.75,
  contentWidth: 72,
  ollamaModel: '',
  ttsVoice: 'Christopher',
  systemPrompt: 'You are a knowledgeable academic assistant. Answer questions about the provided document clearly and precisely, using appropriate scholarly terminology.'
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
