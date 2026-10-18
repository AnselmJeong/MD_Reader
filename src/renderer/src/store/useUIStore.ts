import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultReaderLayout, restoreReaderLayout, type ReaderLayout, type EpubSpreadMode } from '../../../shared/reader-layout'

interface UIState extends ReaderLayout {
  showSettings: boolean
  showReadingSettings: boolean
  showSearch: boolean
  selectedText: string | null

  toggleToC: () => void
  toggleChat: () => void
  toggleSettings: () => void
  toggleReadingSettings: () => void
  setShowReadingSettings: (show: boolean) => void
  toggleSearch: () => void
  toggleFocusMode: () => void
  setFocusMode: (enabled: boolean) => void
  setShowSearch: (show: boolean) => void
  setSelectedText: (text: string | null) => void
  setChatWidth: (width: number) => void
  setEpubSpreadMode: (mode: EpubSpreadMode) => void
}

export const useUIStore = create<UIState>()(persist((set) => ({
  ...defaultReaderLayout,
  showSettings: false,
  showReadingSettings: false,
  showSearch: false,
  selectedText: null,

  toggleToC: () => set((s) => ({ showToC: !s.showToC })),
  toggleChat: () => set((s) => ({ showChat: !s.showChat })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleReadingSettings: () => set((s) => ({ showReadingSettings: !s.showReadingSettings })),
  setShowReadingSettings: (show) => set({ showReadingSettings: show }),
  toggleSearch: () => set((s) => ({ showSearch: !s.showSearch })),
  toggleFocusMode: () => set((s) => ({
    focusMode: !s.focusMode,
    showReadingSettings: s.focusMode ? s.showReadingSettings : false
  })),
  setFocusMode: (enabled) => set({
    focusMode: enabled,
    ...(enabled ? { showReadingSettings: false } : {})
  }),
  setShowSearch: (show) => set({ showSearch: show }),
  setSelectedText: (text) => set({ selectedText: text }),
  setChatWidth: (width) => set({ chatWidth: restoreReaderLayout({ chatWidth: width }).chatWidth }),
  setEpubSpreadMode: (mode) => set({ epubSpreadMode: mode })
}), {
  name: 'md-reader-layout',
  version: 1,
  partialize: ({ chatWidth, showChat, showToC, focusMode, epubSpreadMode }) => ({ chatWidth, showChat, showToC, focusMode, epubSpreadMode }),
  merge: (saved, current) => ({ ...current, ...restoreReaderLayout(saved) })
}))
