import { create } from 'zustand'

interface UIState {
  showToC: boolean
  showChat: boolean
  showSettings: boolean
  showSearch: boolean
  selectedText: string | null
  chatWidth: number

  toggleToC: () => void
  toggleChat: () => void
  toggleSettings: () => void
  toggleSearch: () => void
  setShowSearch: (show: boolean) => void
  setSelectedText: (text: string | null) => void
  setChatWidth: (width: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  showToC: false,
  showChat: true,
  showSettings: false,
  showSearch: false,
  selectedText: null,
  chatWidth: 320,

  toggleToC: () => set((s) => ({ showToC: !s.showToC })),
  toggleChat: () => set((s) => ({ showChat: !s.showChat })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleSearch: () => set((s) => ({ showSearch: !s.showSearch })),
  setShowSearch: (show) => set({ showSearch: show }),
  setSelectedText: (text) => set({ selectedText: text }),
  setChatWidth: (width) => set({ chatWidth: width })
}))
