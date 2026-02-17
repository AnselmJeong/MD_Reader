import { create } from 'zustand'

type Theme = 'light' | 'sepia' | 'dark'

interface SettingsState {
  theme: Theme
  fontSize: number
  lineHeight: number
  contentWidth: number

  setTheme: (theme: Theme) => void
  setFontSize: (size: number) => void
  setLineHeight: (height: number) => void
  setContentWidth: (width: number) => void
  cycleTheme: () => void
}

const themeOrder: Theme[] = ['light', 'sepia', 'dark']

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  fontSize: 17,
  lineHeight: 1.75,
  contentWidth: 72,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  setFontSize: (size) => {
    const clamped = Math.min(22, Math.max(14, size))
    set({ fontSize: clamped })
  },

  setLineHeight: (height) => set({ lineHeight: height }),
  setContentWidth: (width) => set({ contentWidth: width }),

  cycleTheme: () => {
    const { theme } = get()
    const idx = themeOrder.indexOf(theme)
    const next = themeOrder[(idx + 1) % themeOrder.length]
    document.documentElement.setAttribute('data-theme', next)
    set({ theme: next })
  }
}))
