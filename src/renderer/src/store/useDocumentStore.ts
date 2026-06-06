import { create } from 'zustand'
import type { FileReadResult } from '../global'

export type DocumentKind = 'markdown' | 'epub'

interface BaseDocumentTab {
  id: string
  filePath: string
  fileName: string
  kind: DocumentKind
  content: string
  documentHash: string
  wordCount: number
  readingTime: number
  isDirty: boolean
}

export interface MarkdownDocumentTab extends BaseDocumentTab {
  kind: 'markdown'
  bibContent: string | null
}

export interface EpubDocumentTab extends BaseDocumentTab {
  kind: 'epub'
  bibContent: null
  epubBase64: string
  currentLocation: string | null
  currentChapterHref: string | null
  currentChapterLabel: string | null
}

export type DocumentTab = MarkdownDocumentTab | EpubDocumentTab

interface DocumentState {
  tabs: DocumentTab[]
  activeTab: DocumentTab | null
  activeTabId: string | null
  kind: DocumentKind | null
  filePath: string | null
  fileName: string | null
  content: string | null
  bibContent: string | null
  epubBase64: string | null
  documentHash: string | null
  recentFiles: string[]
  wordCount: number
  readingTime: number
  isDirty: boolean

  setDocument: (document: FileReadResult) => void
  updateContent: (content: string) => void
  updateEpubContent: (tabId: string, content: string) => void
  updateEpubLocation: (
    tabId: string,
    currentLocation: string | null,
    chapterHref?: string | null,
    chapterLabel?: string | null
  ) => void
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

function getFileName(filePath: string) {
  return filePath.split('/').pop() || filePath
}

function createDocumentTab(document: FileReadResult): DocumentTab {
  const fileName = getFileName(document.filePath)
  const { words, readingTime } = getDocumentStats(document.content)

  if (document.kind === 'epub') {
    return {
      id: document.filePath,
      filePath: document.filePath,
      fileName,
      kind: 'epub',
      content: document.content,
      documentHash: document.documentHash,
      bibContent: null,
      epubBase64: document.epubBase64,
      currentLocation: null,
      currentChapterHref: null,
      currentChapterLabel: null,
      wordCount: words,
      readingTime,
      isDirty: false
    }
  }

  return {
    id: document.filePath,
    filePath: document.filePath,
    fileName,
    kind: 'markdown',
    content: document.content,
    documentHash: document.documentHash,
    bibContent: document.bibContent ?? null,
    wordCount: words,
    readingTime,
    isDirty: false
  }
}

function activeFields(tab: DocumentTab | null) {
  return {
    activeTab: tab,
    activeTabId: tab?.id ?? null,
    kind: tab?.kind ?? null,
    filePath: tab?.filePath ?? null,
    fileName: tab?.fileName ?? null,
    content: tab?.content ?? null,
    bibContent: tab?.bibContent ?? null,
    epubBase64: tab?.kind === 'epub' ? tab.epubBase64 : null,
    documentHash: tab?.documentHash ?? null,
    wordCount: tab?.wordCount ?? 0,
    readingTime: tab?.readingTime ?? 0,
    isDirty: tab?.isDirty ?? false
  }
}

export const useDocumentStore = create<DocumentState>((set) => ({
  tabs: [],
  activeTab: null,
  activeTabId: null,
  kind: null,
  filePath: null,
  fileName: null,
  content: null,
  bibContent: null,
  epubBase64: null,
  documentHash: null,
  recentFiles: [],
  wordCount: 0,
  readingTime: 0,
  isDirty: false,

  setDocument: (document) => {
    const nextTab = createDocumentTab(document)
    set((state) => {
      const existingIndex = state.tabs.findIndex((tab) => tab.filePath === document.filePath)
      const tabs = existingIndex >= 0
        ? state.tabs.map((tab, index) => {
          if (index !== existingIndex) return tab
          if (tab.kind === 'epub' && nextTab.kind === 'epub') {
            return {
              ...nextTab,
              currentLocation: tab.currentLocation,
              currentChapterHref: tab.currentChapterHref,
              currentChapterLabel: tab.currentChapterLabel
            }
          }
          return nextTab
        })
        : [...state.tabs, nextTab]
      const active = tabs.find((tab) => tab.id === nextTab.id) ?? nextTab
      return { tabs, ...activeFields(active) }
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

  updateEpubContent: (tabId, content) => {
    const { words, readingTime } = getDocumentStats(content)
    set((state) => {
      const tabs = state.tabs.map((tab) => (
        tab.id === tabId && tab.kind === 'epub'
          ? { ...tab, content, wordCount: words, readingTime }
          : tab
      ))
      if (state.activeTabId !== tabId) return { tabs }
      const active = tabs.find((tab) => tab.id === tabId) ?? null
      return { tabs, ...activeFields(active) }
    })
  },

  updateEpubLocation: (tabId, currentLocation, chapterHref, chapterLabel) => {
    set((state) => {
      const tabs = state.tabs.map((tab) => (
        tab.id === tabId && tab.kind === 'epub'
          ? {
            ...tab,
            currentLocation,
            currentChapterHref: chapterHref ?? tab.currentChapterHref,
            currentChapterLabel: chapterLabel ?? tab.currentChapterLabel
          }
          : tab
      ))
      if (state.activeTabId !== tabId) return { tabs }
      const active = tabs.find((tab) => tab.id === tabId) ?? null
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
      activeTab: null,
      activeTabId: null,
      kind: null,
      filePath: null,
      fileName: null,
      content: null,
      bibContent: null,
      epubBase64: null,
      documentHash: null,
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
