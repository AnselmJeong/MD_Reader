import { create } from 'zustand'

export interface DocumentTab {
  id: string
  filePath: string
  fileName: string
  content: string
  bibContent: string | null
  wordCount: number
  readingTime: number
  isDirty: boolean
}

interface DocumentState {
  tabs: DocumentTab[]
  activeTabId: string | null
  filePath: string | null
  fileName: string | null
  content: string | null
  bibContent: string | null
  recentFiles: string[]
  wordCount: number
  readingTime: number
  isDirty: boolean

  setDocument: (filePath: string, content: string, bibContent: string | null) => void
  updateContent: (content: string) => void
  markSaved: () => void
  clearDocument: () => void
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  setRecentFiles: (files: string[]) => void
}

function getDocumentStats(content: string) {
  const words = content.split(/\s+/).filter(Boolean).length
  const readingTime = Math.max(1, Math.ceil(words / 200))
  return { words, readingTime }
}

function createDocumentTab(filePath: string, content: string, bibContent: string | null): DocumentTab {
  const fileName = filePath.split('/').pop() || filePath
  const { words, readingTime } = getDocumentStats(content)
  return {
    id: filePath,
    filePath,
    fileName,
    content,
    bibContent,
    wordCount: words,
    readingTime,
    isDirty: false
  }
}

function activeFields(tab: DocumentTab | null) {
  return {
    activeTabId: tab?.id ?? null,
    filePath: tab?.filePath ?? null,
    fileName: tab?.fileName ?? null,
    content: tab?.content ?? null,
    bibContent: tab?.bibContent ?? null,
    wordCount: tab?.wordCount ?? 0,
    readingTime: tab?.readingTime ?? 0,
    isDirty: tab?.isDirty ?? false
  }
}

export const useDocumentStore = create<DocumentState>((set) => ({
  tabs: [],
  activeTabId: null,
  filePath: null,
  fileName: null,
  content: null,
  bibContent: null,
  recentFiles: [],
  wordCount: 0,
  readingTime: 0,
  isDirty: false,

  setDocument: (filePath, content, bibContent) => {
    const nextTab = createDocumentTab(filePath, content, bibContent)
    set((state) => {
      const existingIndex = state.tabs.findIndex((tab) => tab.filePath === filePath)
      const tabs = existingIndex >= 0
        ? state.tabs.map((tab, index) => index === existingIndex ? nextTab : tab)
        : [...state.tabs, nextTab]
      return { tabs, ...activeFields(nextTab) }
    })
  },

  updateContent: (content) => {
    const { words, readingTime } = getDocumentStats(content)
    set((state) => {
      if (!state.activeTabId) return { content, wordCount: words, readingTime, isDirty: true }
      const tabs = state.tabs.map((tab) => (
        tab.id === state.activeTabId
          ? { ...tab, content, wordCount: words, readingTime, isDirty: true }
          : tab
      ))
      const active = tabs.find((tab) => tab.id === state.activeTabId) ?? null
      return { tabs, ...activeFields(active) }
    })
  },

  markSaved: () => set((state) => {
    if (!state.activeTabId) return { isDirty: false }
    const tabs = state.tabs.map((tab) => (
      tab.id === state.activeTabId ? { ...tab, isDirty: false } : tab
    ))
    const active = tabs.find((tab) => tab.id === state.activeTabId) ?? null
    return { tabs, ...activeFields(active) }
  }),

  clearDocument: () =>
    set({
      tabs: [],
      activeTabId: null,
      filePath: null,
      fileName: null,
      content: null,
      bibContent: null,
      wordCount: 0,
      readingTime: 0,
      isDirty: false
    }),

  selectTab: (tabId) => set((state) => {
    const active = state.tabs.find((tab) => tab.id === tabId) ?? null
    return activeFields(active)
  }),

  closeTab: (tabId) => set((state) => {
    const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId)
    const tabs = state.tabs.filter((tab) => tab.id !== tabId)
    if (state.activeTabId !== tabId) return { tabs }
    const nextActive = tabs[Math.max(0, closingIndex - 1)] ?? tabs[0] ?? null
    return { tabs, ...activeFields(nextActive) }
  }),

  setRecentFiles: (files) => set({ recentFiles: files })
}))
