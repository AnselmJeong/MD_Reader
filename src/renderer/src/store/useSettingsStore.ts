import { create } from 'zustand'

type Theme = 'light' | 'sepia' | 'dark'
export type TtsVoice = 'Ava' | 'Christopher'

interface SettingsState {
  theme: Theme
  fontSize: number
  aiSidebarFontSize: number
  lineHeight: number
  contentWidth: number
  ttsVoice: TtsVoice

  setTheme: (theme: Theme) => void
  setFontSize: (size: number) => void
  setAiSidebarFontSize: (size: number) => void
  setLineHeight: (height: number) => void
  setContentWidth: (width: number) => void
  setTtsVoice: (voice: TtsVoice) => void
  cycleTheme: () => void
}

const themeOrder: Theme[] = ['light', 'sepia', 'dark']

const persistSetting = (key: string, value: unknown) => {
  void window.api.settings.set(key, value)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  fontSize: 17,
  aiSidebarFontSize: 14,
  lineHeight: 1.75,
  contentWidth: 72,
  ttsVoice: 'Christopher',

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
    persistSetting('theme', theme)
  },

  setFontSize: (size) => {
    const clamped = Math.min(22, Math.max(14, size))
    set({ fontSize: clamped })
    persistSetting('fontSize', clamped)
  },

  setAiSidebarFontSize: (size) => {
    const clamped = Math.min(20, Math.max(12, size))
    set({ aiSidebarFontSize: clamped })
    persistSetting('aiSidebarFontSize', clamped)
  },

  setLineHeight: (height) => {
    set({ lineHeight: height })
    persistSetting('lineHeight', height)
  },
  setContentWidth: (width) => {
    set({ contentWidth: width })
    persistSetting('contentWidth', width)
  },
  setTtsVoice: (voice) => {
    set({ ttsVoice: voice })
    persistSetting('ttsVoice', voice)
  },

  cycleTheme: () => {
    const { theme } = get()
    const idx = themeOrder.indexOf(theme)
    const next = themeOrder[(idx + 1) % themeOrder.length]
    document.documentElement.setAttribute('data-theme', next)
    set({ theme: next })
    persistSetting('theme', next)
  }
}))
