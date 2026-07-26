import { SimpleStore } from './simple-store'
import { DEFAULT_AI_SYSTEM_PROMPT, resolveAiSystemPrompt } from '../shared/ai-prompts'

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
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT
})

const resolvedSystemPrompt = resolveAiSystemPrompt(store.get('systemPrompt'))
if (resolvedSystemPrompt !== store.get('systemPrompt')) {
  store.set('systemPrompt', resolvedSystemPrompt)
}

export function getSettings(key?: string): unknown {
  if (key) {
    return store.get(key as keyof AppSettings)
  }
  return store.getAll()
}

export function setSettings(key: string, value: unknown): void {
  store.set(key as keyof AppSettings, value as never)
}
