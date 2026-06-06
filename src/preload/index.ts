import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

export type DocumentKind = 'markdown' | 'epub'

export type FileReadResult =
  | {
      kind: 'markdown'
      filePath: string
      content: string
      documentHash: string
      bibContent?: string | null
    }
  | {
      kind: 'epub'
      filePath: string
      content: string
      documentHash: string
      epubBase64: string
      bibContent?: null
    }

export type ChatDocumentKind = 'markdown' | 'epub'
export type ChatMessageRole = 'user' | 'assistant'
export type SessionTitleStatus = 'pending' | 'generated' | 'fallback'

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

export interface ElectronAPI {
  file: {
    openDialog: () => Promise<FileReadResult | null>
    read: (path: string) => Promise<FileReadResult>
    getRecent: () => Promise<string[]>
    save: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  }
  ollama: {
    listModels: () => Promise<Array<{ name: string; size: number }>>
    chat: (params: {
      model: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
    }) => Promise<{ success?: boolean; error?: string }>
    stop: () => Promise<{ success: boolean }>
    onToken: (callback: (token: string) => void) => () => void
    onDone: (callback: () => void) => () => void
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
    }) => Promise<{ sessionId: string; contextKey: string; title: string }>
    loadSession: (sessionId: string) => Promise<{ session: ChatSessionRecord; messages: StoredChatMessage[] } | null>
    archiveSession: (sessionId: string) => Promise<{ success: boolean }>
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
    openDialog: () => ipcRenderer.invoke('file:open-dialog'),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
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
    onDone: (callback: () => void) => {
      const handler = () => callback()
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
  chat: {
    exportMarkdown: (markdown: string) => ipcRenderer.invoke('chat:export', markdown),
    listSessions: (contextMeta) => ipcRenderer.invoke('chat:sessions:list', contextMeta),
    saveSession: (params) => ipcRenderer.invoke('chat:sessions:save', params),
    loadSession: (sessionId) => ipcRenderer.invoke('chat:sessions:load', sessionId),
    archiveSession: (sessionId) => ipcRenderer.invoke('chat:sessions:archive', sessionId)
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
