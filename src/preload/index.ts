import type { AiProviderStatus, SubscriptionStatus, SubscriptionProvider } from '../shared/subscription'
import type { BibliographyResult } from '../shared/bibliography'
import type { CommentaryAPI } from '../shared/commentary'
import type { CoachAPI, CoachDeckUpdate } from '../shared/coach'
import type { ChatImage, ModelVisionInfo } from '../shared/chat-images'
import type { ChatRequestOptions } from '../shared/chat-request-options'
import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

export type DocumentKind = 'markdown' | 'epub'

export type FileReadResult =
  | (BibliographyResult & {
      kind: 'markdown'
      filePath: string
      content: string
      documentHash: string
    })
  | {
      kind: 'epub'
      filePath: string
      content: string
      documentHash: string
      epubBase64: string
      lastCfi?: string | null
      lastChapterHref?: string | null
      lastChapterLabel?: string | null
      lastProgress?: number | null
      bibContent?: null
    }

export type ChatDocumentKind = 'markdown' | 'epub'
export type ChatMessageRole = 'user' | 'assistant'
export type SessionTitleStatus = 'pending' | 'generated' | 'fallback'
export type EpubAnnotationStyle = 'yellow' | 'green' | 'blue' | 'pink' | 'red-underline'
export type EpubAnnotationKind = 'highlight' | 'underline'

export interface ChatSource {
  id: string
  title: string
  url: string
  hostname?: string
  snippet?: string
  fetchedTitle?: string
}

export interface ChatCompletionMetadata {
  sources?: ChatSource[]
}

export type { AiProviderStatus } from '../shared/subscription'

export interface ChatContextMeta {
  documentKind: ChatDocumentKind
  documentId: string
  fileName: string
  lastFilePath?: string | null
  contextTitle: string
  chapterHref?: string | null
  chapterLabel?: string | null
  lastCfi?: string | null
  contentHash?: string | null
}

export interface StoredChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  timestamp: number
  quotedText?: string | null
  sources?: ChatSource[]
  images?: ChatImage[]
}

export interface ChatSessionSummary {
  id: string
  contextKey: string
  title: string
  titleStatus: SessionTitleStatus
  messageCount: number
  createdAt: number
  updatedAt: number
  model?: string | null
}

export interface ChatSessionRecord extends ChatSessionSummary {
  systemPrompt?: string | null
}

export interface AgentMemoryStatus {
  settings: {
    enabled?: boolean
    extractionEnabled?: boolean
    runtimeInjectionEnabled?: boolean
    hindsightBaseUrl?: string
    hindsightBankId?: string
    extractorModel?: string
    hasHindsightApiKey?: boolean
  }
  paths: { dir: string; user: string; soul: string; reviewQueue: string }
  hindsight: { ok: boolean; error?: string }
}

export interface EpubAnnotationRecord {
  id: string
  documentId: string
  fileName: string
  filePath?: string | null
  cfiRange: string
  text: string
  style: EpubAnnotationStyle
  kind: EpubAnnotationKind
  chapterHref?: string | null
  chapterLabel?: string | null
  note?: string | null
  createdAt: number
  updatedAt: number
}

export interface EpubReadingProgressRecord {
  documentId: string
  fileName: string
  filePath?: string | null
  cfi: string
  chapterHref?: string | null
  chapterLabel?: string | null
  progress?: number | null
  updatedAt: number
}

export interface ElectronAPI {
  commentary: CommentaryAPI
  coach: CoachAPI
  file: {
    selectBibliography: (path: string) => Promise<BibliographyResult | null>
    resetBibliography: (path: string) => Promise<BibliographyResult>
    openDialog: () => Promise<FileReadResult | null>
    read: (path: string) => Promise<FileReadResult>
    readImage: (documentPath: string, source: string) => Promise<string | null>
    getRecent: () => Promise<string[]>
    save: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  }
  ai: {
    listModels: () => Promise<Array<{ name: string; size: number }>>
    modelVision: (model: string) => Promise<ModelVisionInfo>
    chat: (params: ChatRequestOptions & {
      model: string
      messages: Array<{ role: string; content: string; images?: ChatImage[] }>
      systemPrompt?: string
      memoryContext?: {
        userText: string
        contextTitle?: string | null
        quotedText?: string | null
      }
    }) => Promise<{ success?: boolean; error?: string }>
    stop: () => Promise<{ success: boolean }>
    onToken: (callback: (token: string) => void) => () => void
    onSearchEnd: (callback: () => void) => () => void
    onSearchStart: (callback: (payload: { query: string }) => void) => () => void
    onSearchResults: (callback: (payload: { sources: ChatSource[] }) => void) => () => void
    onMetadata: (callback: (metadata: ChatCompletionMetadata) => void) => () => void
    onDone: (callback: (metadata?: ChatCompletionMetadata) => void) => () => void
    onStopped: (callback: () => void) => () => void
    onError: (callback: (error: string) => void) => () => void
    generateTitle: (params: {
      model: string
      contextTitle: string
      messages: Array<{ role: string; content: string }>
    }) => Promise<{ success: boolean; title?: string; error?: string }>
  }
  settings: {
    get: (key?: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<{ success: boolean }>
  }
  fonts: {
    listKorean: () => Promise<string[]>
  }
  subscriptions: {
    status: () => Promise<SubscriptionStatus>
    action: (provider: SubscriptionProvider, action: 'login' | 'cancelLogin' | 'logout') => Promise<void>
  }
  aiProvider: {
    status: () => Promise<AiProviderStatus>
    updateSettings: (partial: {
      tinyfishApiKey?: string
      webSearchEnabled?: boolean
      webSearchMaxResults?: number
    }) => Promise<AiProviderStatus>
  }
  chat: {
    exportMarkdown: (markdown: string, images?: ChatImage[]) => Promise<{ success: boolean; filePath?: string }>
    listSessions: (contextMeta: ChatContextMeta) => Promise<{ contextKey: string; sessions: ChatSessionSummary[] }>
    saveSession: (params: {
      sessionId?: string | null
      contextMeta: ChatContextMeta
      title?: string | null
      titleStatus?: SessionTitleStatus
      model?: string | null
      systemPrompt?: string | null
      messages: StoredChatMessage[]
      processMemory?: boolean
    }) => Promise<{ sessionId: string; contextKey: string; title: string }>
    loadSession: (sessionId: string) => Promise<{ session: ChatSessionRecord; messages: StoredChatMessage[] } | null>
    archiveSession: (sessionId: string) => Promise<{ success: boolean }>
  }
  agentMemory: {
    status: () => Promise<AgentMemoryStatus>
    updateSettings: (partial: {
      enabled?: boolean
      extractionEnabled?: boolean
      runtimeInjectionEnabled?: boolean
      hindsightBaseUrl?: string
      hindsightApiKey?: string
      hindsightBankId?: string
      extractorModel?: string
    }) => Promise<AgentMemoryStatus>
    processSession: (sessionId: string) => Promise<{ success: boolean }>
    openFolder: () => Promise<{ success: boolean; error?: string }>
  }
  epub: {
    listAnnotations: (params: {
      documentId: string
      fileName: string
    }) => Promise<EpubAnnotationRecord[]>
    saveAnnotation: (params: {
      documentId: string
      fileName: string
      filePath?: string | null
      cfiRange: string
      text: string
      style: EpubAnnotationStyle
      kind: EpubAnnotationKind
      chapterHref?: string | null
      chapterLabel?: string | null
      note?: string | null
    }) => Promise<EpubAnnotationRecord>
    deleteAnnotation: (params: {
      documentId: string
      cfiRange: string
    }) => Promise<{ success: boolean }>
    getProgress: (params: {
      documentId: string
      filePath?: string | null
    }) => Promise<EpubReadingProgressRecord | null>
    saveProgress: (params: {
      documentId: string
      fileName: string
      filePath?: string | null
      cfi: string
      chapterHref?: string | null
      chapterLabel?: string | null
      progress?: number | null
    }) => Promise<EpubReadingProgressRecord>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  utils: {
    getPathForFile: (file: File) => string
  }
}

const api: ElectronAPI = {
  commentary: {
    onEscape: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('commentary:escape', handler)
      ipcRenderer.send('commentary:escape-listening', true)
      return () => { ipcRenderer.removeListener('commentary:escape', handler); ipcRenderer.send('commentary:escape-listening', false) }
    },
    onChange: (callback) => {
      const handler = (_event: IpcRendererEvent, documentId: string) => callback(documentId)
      ipcRenderer.on('commentary:changed', handler)
      return () => ipcRenderer.removeListener('commentary:changed', handler)
    },
    list: (documentId) => ipcRenderer.invoke('commentary:list', documentId),
    save: (params) => ipcRenderer.invoke('commentary:save', params),
    setDeleted: (documentId, id, deleted) => ipcRenderer.invoke('commentary:deleted', documentId, id, deleted),
    importImage: (documentId) => ipcRenderer.invoke('commentary:image', documentId),
    importImageData: (documentId, dataUrl, name) => ipcRenderer.invoke('commentary:image-data', documentId, dataUrl, name),
    importHtml: () => ipcRenderer.invoke('commentary:html'),
    permanentlyDelete: (documentId, id, expectedUpdatedAt) => ipcRenderer.invoke('commentary:permanently-delete', documentId, id, expectedUpdatedAt),
    exportEpub: (filePath, documentId) => ipcRenderer.invoke('commentary:export', filePath, documentId)
  },
  file: {
    selectBibliography: (path: string) => ipcRenderer.invoke('file:select-bibliography', path),
    resetBibliography: (path: string) => ipcRenderer.invoke('file:reset-bibliography', path),
    openDialog: () => ipcRenderer.invoke('file:open-dialog'),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    readImage: (documentPath: string, source: string) => ipcRenderer.invoke('file:read-image', documentPath, source),
    getRecent: () => ipcRenderer.invoke('file:recent-list'),
    save: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content)
  },
  ai: {
    listModels: () => ipcRenderer.invoke('ai:list-models'),
    modelVision: (model) => ipcRenderer.invoke('ai:model-vision', model),
    chat: (params) => ipcRenderer.invoke('ai:chat', params),
    stop: () => ipcRenderer.invoke('ai:stop'),
    onToken: (callback: (token: string) => void) => {
      const handler = (_event: IpcRendererEvent, token: string) => callback(token)
      ipcRenderer.on('ai:token', handler)
      return () => ipcRenderer.removeListener('ai:token', handler)
    },
    onSearchEnd: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('ai:search-end', handler)
      return () => ipcRenderer.removeListener('ai:search-end', handler)
    },
    onSearchStart: (callback: (payload: { query: string }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { query: string }) => callback(payload)
      ipcRenderer.on('ai:search-start', handler)
      return () => ipcRenderer.removeListener('ai:search-start', handler)
    },
    onSearchResults: (callback: (payload: { sources: ChatSource[] }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { sources: ChatSource[] }) => callback(payload)
      ipcRenderer.on('ai:search-results', handler)
      return () => ipcRenderer.removeListener('ai:search-results', handler)
    },
    onMetadata: (callback: (metadata: ChatCompletionMetadata) => void) => {
      const handler = (_event: IpcRendererEvent, metadata: ChatCompletionMetadata) => callback(metadata)
      ipcRenderer.on('ai:metadata', handler)
      return () => ipcRenderer.removeListener('ai:metadata', handler)
    },
    onDone: (callback: (metadata?: ChatCompletionMetadata) => void) => {
      const handler = (_event: IpcRendererEvent, metadata?: ChatCompletionMetadata) => callback(metadata)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onStopped: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('ai:stopped', handler)
      return () => ipcRenderer.removeListener('ai:stopped', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    },
    generateTitle: (params) => ipcRenderer.invoke('ai:generate-title', params)
  },
  settings: {
    get: (key?: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  fonts: {
    listKorean: () => ipcRenderer.invoke('fonts:list-korean')
  },
  subscriptions: {
    status: () => ipcRenderer.invoke('subscriptions:status'),
    action: (provider, action) => ipcRenderer.invoke('subscriptions:action', provider, action)
  },
  aiProvider: {
    status: () => ipcRenderer.invoke('ai-provider:status'),
    updateSettings: (partial) => ipcRenderer.invoke('ai-provider:update-settings', partial)
  },
  chat: {
    exportMarkdown: (markdown: string, images?: ChatImage[]) => ipcRenderer.invoke('chat:export', markdown, images),
    listSessions: (contextMeta) => ipcRenderer.invoke('chat:sessions:list', contextMeta),
    saveSession: (params) => ipcRenderer.invoke('chat:sessions:save', params),
    loadSession: (sessionId) => ipcRenderer.invoke('chat:sessions:load', sessionId),
    archiveSession: (sessionId) => ipcRenderer.invoke('chat:sessions:archive', sessionId)
  },
  agentMemory: {
    status: () => ipcRenderer.invoke('agent-memory:status'),
    updateSettings: (partial) => ipcRenderer.invoke('agent-memory:update-settings', partial),
    processSession: (sessionId) => ipcRenderer.invoke('agent-memory:process-session', sessionId),
    openFolder: () => ipcRenderer.invoke('agent-memory:open-folder')
  },
  coach: {
    getPreferences: (documentId) => ipcRenderer.invoke('coach:preferences:get', documentId),
    setPreferences: (documentId, preferences) => ipcRenderer.invoke('coach:preferences:set', documentId, preferences),
    getSettings: () => ipcRenderer.invoke('coach:settings:get'),
    setSettings: (partial) => ipcRenderer.invoke('coach:settings:set', partial),
    requestDeck: (request) => ipcRenderer.invoke('coach:deck', request),
    recordEvent: (event) => ipcRenderer.invoke('coach:event', event),
    getProfile: () => ipcRenderer.invoke('coach:profile'),
    resetProfile: () => ipcRenderer.invoke('coach:profile:reset'),
    getUsage: () => ipcRenderer.invoke('coach:usage'),
    getImage: (card) => ipcRenderer.invoke('coach:image', card),
    getLinks: (request) => ipcRenderer.invoke('coach:links', request),
    getMemoryLinks: (request) => ipcRenderer.invoke('coach:memory-links', request),
    openedCards: (documentId, chapterHref) => ipcRenderer.invoke('coach:opened', documentId, chapterHref),
    addReviews: (request) => ipcRenderer.invoke('coach:reviews:add', request),
    dueReviews: () => ipcRenderer.invoke('coach:reviews:due'),
    answerReview: (id, remembered) => ipcRenderer.invoke('coach:reviews:answer', id, remembered),
    onDeck: (callback) => {
      const handler = (_event: IpcRendererEvent, update: CoachDeckUpdate) => callback(update)
      ipcRenderer.on('coach:deck', handler)
      return () => ipcRenderer.removeListener('coach:deck', handler)
    }
  },
  epub: {
    listAnnotations: (params) => ipcRenderer.invoke('epub:annotations:list', params),
    saveAnnotation: (params) => ipcRenderer.invoke('epub:annotations:save', params),
    deleteAnnotation: (params) => ipcRenderer.invoke('epub:annotations:delete', params),
    getProgress: (params) => ipcRenderer.invoke('epub:progress:get', params),
    saveProgress: (params) => ipcRenderer.invoke('epub:progress:save', params)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  utils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
