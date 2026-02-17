import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'

export interface ElectronAPI {
  file: {
    openDialog: () => Promise<{ filePath: string; content: string; bibContent?: string | null } | null>
    read: (path: string) => Promise<{ filePath: string; content: string; bibContent?: string | null }>
    getRecent: () => Promise<string[]>
  }
  ollama: {
    listModels: () => Promise<Array<{ name: string; size: number }>>
    chat: (params: {
      model: string
      messages: Array<{ role: string; content: string }>
      systemPrompt?: string
    }) => Promise<{ success?: boolean; error?: string }>
    onToken: (callback: (token: string) => void) => () => void
    onDone: (callback: () => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
  settings: {
    get: (key?: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<{ success: boolean }>
  }
  chat: {
    exportMarkdown: (markdown: string) => Promise<{ success: boolean; filePath?: string }>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  utils: {
    getPathForFile: (file: File) => string
  }
}

const api: ElectronAPI = {
  file: {
    openDialog: () => ipcRenderer.invoke('file:open-dialog'),
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    getRecent: () => ipcRenderer.invoke('file:recent-list')
  },
  ollama: {
    listModels: () => ipcRenderer.invoke('ollama:list-models'),
    chat: (params) => ipcRenderer.invoke('ollama:chat', params),
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
    onError: (callback: (error: string) => void) => {
      const handler = (_event: IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('ollama:error', handler)
      return () => ipcRenderer.removeListener('ollama:error', handler)
    }
  },
  settings: {
    get: (key?: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  chat: {
    exportMarkdown: (markdown: string) => ipcRenderer.invoke('chat:export', markdown)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  utils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)
