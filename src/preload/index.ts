import type { BibliographyResult } from '../shared/bibliography'
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

export interface AiProviderStatus {
  hasOllamaApiKey: boolean
  ollamaBaseUrl: string
  ollamaSearchBaseUrl: string
  webSearchEnabled: boolean
  webSearchMaxResults: number
  apiKeySource: 'env' | 'saved' | 'none'
}

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
    mem0BaseUrl?: string
    mem0AuthMode?: string
    userId?: string
    extractorModel?: string
    hasMem0ApiKey?: boolean
  }
  paths: { dir: string; user: string; soul: string; reviewQueue: string }
  mem0: { ok: boolean; error?: string }
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
  file: {
    selectBibliography: (path: string) => Promise<BibliographyResult | null>
    resetBibliography: (path: string) => Promise<BibliographyResult>
    openDialog: () => Promise<FileReadResult | null>
    read: (path: string) => Promise<FileReadResult>
    readImage: (documentPath: string, source: string) => Promise<string | null>
    getRecent: () => Promise<string[]>
    save: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  }
  ollama: {
    listModels: () => Promise<Array<{ name: string; size: number }>>
    chat: (params: {
      model: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
      memoryContext?: {
        userText: string
        contextTitle?: string | null
        quotedText?: string | null
      }
    }) => Promise<{ success?: boolean; error?: string }>
    stop: () => Promise<{ success: boolean }>
    onToken: (callback: (token: string) => void) => () => void
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
  aiProvider: {
    status: () => Promise<AiProviderStatus>
    updateSettings: (partial: {
      ollamaApiKey?: string
      ollamaBaseUrl?: string
      ollamaSearchBaseUrl?: string
      webSearchEnabled?: boolean
      webSearchMaxResults?: number
    }) => Promise<AiProviderStatus>
  }
  chat: {
    exportMarkdown: (markdown: string) => Promise<{ success: boolean; filePath?: string }>
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
      mem0BaseUrl?: string
      mem0ApiKey?: string
      mem0AuthMode?: 'x-api-key' | 'bearer' | 'none'
      userId?: string
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
  tts: {
    speak: (params: TtsSpeakParams) => Promise<{ success: boolean; error?: string }>
    pause: () => Promise<{ success: boolean; error?: string }>
    resume: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    restart: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<TtsStatus>
    onStatus: (callback: (status: TtsStatus) => void) => () => void
    onUtteranceStart: (callback: (event: TtsUtteranceEvent) => void) => () => void
    onUtteranceEnd: (callback: (event: TtsUtteranceEvent) => void) => () => void
    onError: (callback: (message: string) => void) => () => void
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  utils: {
    getPathForFile: (file: File) => string
  }
}

export type TtsMode = 'document' | 'selection'
export type TtsState = 'idle' | 'initializing' | 'downloading-model' | 'ready' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

export interface TtsUtterance {
  id: string
  text: string
}

export interface TtsSpeakParams {
  mode: TtsMode
  utterances: TtsUtterance[]
  voice?: string
}

export interface TtsStatus {
  type?: 'status'
  state: TtsState
  mode?: TtsMode | null
  message?: string
  voices?: string[]
}

export interface TtsUtteranceEvent {
  type?: 'utterance-start' | 'utterance-end'
  id: string
  index: number
  text?: string
}

const api: ElectronAPI = {
  file: {
    selectBibliography: (path: string) => ipcRenderer.invoke('file:select-bibliography', path),
    resetBibliography: (path: string) => ipcRenderer.invoke('file:reset-bibliography', path),
    openDialog: () => ipcRenderer.invoke('file:open-dialog'),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    readImage: (documentPath: string, source: string) => ipcRenderer.invoke('file:read-image', documentPath, source),
    getRecent: () => ipcRenderer.invoke('file:recent-list'),
    save: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content)
  },
  ollama: {
    listModels: () => ipcRenderer.invoke('ollama:list-models'),
    chat: (params) => ipcRenderer.invoke('ollama:chat', params),
    stop: () => ipcRenderer.invoke('ollama:stop'),
    onToken: (callback: (token: string) => void) => {
      const handler = (_event: IpcRendererEvent, token: string) => callback(token)
      ipcRenderer.on('ollama:token', handler)
      return () => ipcRenderer.removeListener('ollama:token', handler)
    },
    onSearchStart: (callback: (payload: { query: string }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { query: string }) => callback(payload)
      ipcRenderer.on('ollama:search-start', handler)
      return () => ipcRenderer.removeListener('ollama:search-start', handler)
    },
    onSearchResults: (callback: (payload: { sources: ChatSource[] }) => void) => {
      const handler = (_event: IpcRendererEvent, payload: { sources: ChatSource[] }) => callback(payload)
      ipcRenderer.on('ollama:search-results', handler)
      return () => ipcRenderer.removeListener('ollama:search-results', handler)
    },
    onMetadata: (callback: (metadata: ChatCompletionMetadata) => void) => {
      const handler = (_event: IpcRendererEvent, metadata: ChatCompletionMetadata) => callback(metadata)
      ipcRenderer.on('ollama:metadata', handler)
      return () => ipcRenderer.removeListener('ollama:metadata', handler)
    },
    onDone: (callback: (metadata?: ChatCompletionMetadata) => void) => {
      const handler = (_event: IpcRendererEvent, metadata?: ChatCompletionMetadata) => callback(metadata)
      ipcRenderer.on('ollama:done', handler)
      return () => ipcRenderer.removeListener('ollama:done', handler)
    },
    onStopped: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('ollama:stopped', handler)
      return () => ipcRenderer.removeListener('ollama:stopped', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('ollama:error', handler)
      return () => ipcRenderer.removeListener('ollama:error', handler)
    },
    generateTitle: (params) => ipcRenderer.invoke('ollama:generate-title', params)
  },
  settings: {
    get: (key?: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  fonts: {
    listKorean: () => ipcRenderer.invoke('fonts:list-korean')
  },
  aiProvider: {
    status: () => ipcRenderer.invoke('ai-provider:status'),
    updateSettings: (partial) => ipcRenderer.invoke('ai-provider:update-settings', partial)
  },
  chat: {
    exportMarkdown: (markdown: string) => ipcRenderer.invoke('chat:export', markdown),
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
  epub: {
    listAnnotations: (params) => ipcRenderer.invoke('epub:annotations:list', params),
    saveAnnotation: (params) => ipcRenderer.invoke('epub:annotations:save', params),
    deleteAnnotation: (params) => ipcRenderer.invoke('epub:annotations:delete', params),
    getProgress: (params) => ipcRenderer.invoke('epub:progress:get', params),
    saveProgress: (params) => ipcRenderer.invoke('epub:progress:save', params)
  },
  tts: {
    speak: (params) => ipcRenderer.invoke('tts:speak', params),
    pause: () => ipcRenderer.invoke('tts:pause'),
    resume: () => ipcRenderer.invoke('tts:resume'),
    stop: () => ipcRenderer.invoke('tts:stop'),
    restart: () => ipcRenderer.invoke('tts:restart'),
    status: () => ipcRenderer.invoke('tts:status'),
    onStatus: (callback: (status: TtsStatus) => void) => {
      const handler = (_event: IpcRendererEvent, status: TtsStatus) => callback(status)
      ipcRenderer.on('tts:status', handler)
      return () => ipcRenderer.removeListener('tts:status', handler)
    },
    onUtteranceStart: (callback: (event: TtsUtteranceEvent) => void) => {
      const handler = (_event: IpcRendererEvent, ttsEvent: TtsUtteranceEvent) => callback(ttsEvent)
      ipcRenderer.on('tts:utterance-start', handler)
      return () => ipcRenderer.removeListener('tts:utterance-start', handler)
    },
    onUtteranceEnd: (callback: (event: TtsUtteranceEvent) => void) => {
      const handler = (_event: IpcRendererEvent, ttsEvent: TtsUtteranceEvent) => callback(ttsEvent)
      ipcRenderer.on('tts:utterance-end', handler)
      return () => ipcRenderer.removeListener('tts:utterance-end', handler)
    },
    onError: (callback: (message: string) => void) => {
      const handler = (_event: IpcRendererEvent, error: { message?: string } | string) => {
        callback(typeof error === 'string' ? error : error.message || 'Unknown TTS error')
      }
      ipcRenderer.on('tts:error', handler)
      return () => ipcRenderer.removeListener('tts:error', handler)
    }
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  utils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
