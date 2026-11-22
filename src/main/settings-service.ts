import { nativeTheme } from 'electron'
import { SimpleStore } from './simple-store'
import { DEFAULT_AI_SYSTEM_PROMPT, resolveAiSystemPrompt } from '../shared/ai-prompts'

interface AppSettings {
  theme: 'light' | 'sepia' | 'dark'
  fontSize: number
  aiSidebarFontSize: number
  lineHeight: number
  contentWidth: number
  readerFontFamily: string
  aiModel: string
  systemPrompt: string
}

const store = new SimpleStore<AppSettings>('md-reader-settings', {
  theme: 'light',
  fontSize: 17,
  aiSidebarFontSize: 14,
  lineHeight: 1.75,
  contentWidth: 64,
  readerFontFamily: '',
  aiModel: 'codex:default',
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT
})

store.deleteLegacyKeys(['ollamaModel'])

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
  if (key === 'theme') syncNativeTheme()
}

/**
 * Make the window's colour scheme follow the reader's theme instead of the system's. Books carry
 * their own `prefers-color-scheme: dark` styles; with a dark system and a light reader theme those
 * painted dark boxes onto light paper (and the reverse).
 */
export function syncNativeTheme(): void {
  nativeTheme.themeSource = store.get('theme') === 'dark' ? 'dark' : 'light'
}
