import { create } from 'zustand'

interface UIState {
  showToC: boolean
  showChat: boolean
  showSettings: boolean
  showReadingSettings: boolean
  showSearch: boolean
  focusMode: boolean
  selectedText: string | null
  chatWidth: number

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
}

export const useUIStore = create<UIState>((set) => ({
  showToC: false,
  showChat: true,
  showSettings: false,
  showReadingSettings: false,
  showSearch: false,
  focusMode: false,
  selectedText: null,
  chatWidth: 320,

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
  setChatWidth: (width) => set({ chatWidth: width })
}))
