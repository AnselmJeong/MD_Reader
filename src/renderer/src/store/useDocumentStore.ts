import { create } from 'zustand'

interface DocumentState {
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
  setRecentFiles: (files: string[]) => void
}

function getDocumentStats(content: string) {
  const words = content.split(/\s+/).filter(Boolean).length
  const readingTime = Math.max(1, Math.ceil(words / 200))
  return { words, readingTime }
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  fileName: null,
  content: null,
  bibContent: null,
  recentFiles: [],
  wordCount: 0,
  readingTime: 0,
  isDirty: false,

  setDocument: (filePath, content, bibContent) => {
    const fileName = filePath.split('/').pop() || filePath
    const { words, readingTime } = getDocumentStats(content)
    set({ filePath, fileName, content, bibContent, wordCount: words, readingTime, isDirty: false })
  },

  updateContent: (content) => {
    const { words, readingTime } = getDocumentStats(content)
    set({ content, wordCount: words, readingTime, isDirty: true })
  },

  markSaved: () => set({ isDirty: false }),

  clearDocument: () =>
    set({
      filePath: null,
      fileName: null,
      content: null,
      bibContent: null,
      wordCount: 0,
      readingTime: 0,
      isDirty: false
    }),

  setRecentFiles: (files) => set({ recentFiles: files })
}))
