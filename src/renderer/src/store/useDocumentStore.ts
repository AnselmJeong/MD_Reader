import { create } from 'zustand'

interface DocumentState {
  filePath: string | null
  fileName: string | null
  content: string | null
  bibContent: string | null
  recentFiles: string[]
  wordCount: number
  readingTime: number

  setDocument: (filePath: string, content: string, bibContent: string | null) => void
  clearDocument: () => void
  setRecentFiles: (files: string[]) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  fileName: null,
  content: null,
  bibContent: null,
  recentFiles: [],
  wordCount: 0,
  readingTime: 0,

  setDocument: (filePath, content, bibContent) => {
    const fileName = filePath.split('/').pop() || filePath
    const words = content.split(/\s+/).filter(Boolean).length
    const readingTime = Math.max(1, Math.ceil(words / 200))
    set({ filePath, fileName, content, bibContent, wordCount: words, readingTime })
  },

  clearDocument: () =>
    set({ filePath: null, fileName: null, content: null, bibContent: null, wordCount: 0, readingTime: 0 }),

  setRecentFiles: (files) => set({ recentFiles: files })
}))
