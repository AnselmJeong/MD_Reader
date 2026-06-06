import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readDocumentFile, getRecentFiles, addRecentFile, writeFileContent } from './file-service'
import { listModels, chatStream, generateChatTitle } from './ollama-service'
import { getSettings, setSettings } from './settings-service'
import { controlTts, getTtsStatus, onTtsEvent, speakTts, TtsSpeakParams } from './tts-service'
import {
  archiveChatSession,
  ChatContextMeta,
  listChatSessions,
  loadChatSession,
  SaveChatSessionParams,
  saveChatSession
} from './chat-session-service'

const activeOllamaRequests = new Map<number, AbortController>()

export function registerIpcHandlers(): void {
  onTtsEvent((ttsEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(`tts:${ttsEvent.type}`, ttsEvent)
      }
    }
  })

  // ─── File Operations ───
  ipcMain.handle('file:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Readable Documents', extensions: ['md', 'markdown', 'txt', 'epub'] },
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'EPUB', extensions: ['epub'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const document = await readDocumentFile(filePath)
    await addRecentFile(filePath)
    return document
  })

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const document = await readDocumentFile(filePath)
    await addRecentFile(filePath)
    return document
  })

  ipcMain.handle('file:recent-list', async () => {
    return getRecentFiles()
  })

  ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
    try {
      await writeFileContent(filePath, content)
      await addRecentFile(filePath)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file'
      return { success: false, error: message }
    }
  })

  // ─── Ollama ───
  ipcMain.handle('ollama:list-models', async () => {
    return listModels()
  })

  ipcMain.handle('ollama:chat', async (event, params: {
    model: string
    messages: Array<{ role: string; content: string }>
    systemPrompt?: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: 'No window found' }
    const controller = new AbortController()
    activeOllamaRequests.get(event.sender.id)?.abort()
    activeOllamaRequests.set(event.sender.id, controller)

    try {
      await chatStream(params, (token: string) => {
        if (!win.isDestroyed()) {
          win.webContents.send('ollama:token', token)
        }
      }, controller.signal)
      if (!win.isDestroyed()) {
        win.webContents.send('ollama:done')
      }
      return { success: true }
    } catch (error) {
      if (controller.signal.aborted) {
        if (!win.isDestroyed()) {
          win.webContents.send('ollama:stopped')
        }
        return { stopped: true }
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (!win.isDestroyed()) {
        win.webContents.send('ollama:error', message)
      }
      return { error: message }
    } finally {
      if (activeOllamaRequests.get(event.sender.id) === controller) {
        activeOllamaRequests.delete(event.sender.id)
      }
    }
  })

  ipcMain.handle('ollama:stop', async (event) => {
    const controller = activeOllamaRequests.get(event.sender.id)
    if (!controller) return { success: false }
    controller.abort()
    activeOllamaRequests.delete(event.sender.id)
    return { success: true }
  })

  ipcMain.handle('ollama:generate-title', async (_event, params: {
    model: string
    contextTitle: string
    messages: Array<{ role: string; content: string }>
  }) => {
    try {
      const title = await generateChatTitle(params)
      return { success: true, title }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // ─── Settings ───
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    return getSettings(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    setSettings(key, value)
    return { success: true }
  })

  // ─── TTS ───
  ipcMain.handle('tts:speak', async (_event, params: TtsSpeakParams) => {
    return speakTts(params)
  })

  ipcMain.handle('tts:pause', async () => {
    return controlTts('pause')
  })

  ipcMain.handle('tts:resume', async () => {
    return controlTts('resume')
  })

  ipcMain.handle('tts:stop', async () => {
    return controlTts('stop')
  })

  ipcMain.handle('tts:restart', async () => {
    return controlTts('restart')
  })

  ipcMain.handle('tts:status', async () => {
    return getTtsStatus()
  })

  // ─── Chat Export ───
  ipcMain.handle('chat:export', async (_event, markdown: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: `chat-export-${Date.now()}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    const fs = await import('fs/promises')
    await fs.writeFile(result.filePath, markdown, 'utf-8')
    return { success: true, filePath: result.filePath }
  })

  ipcMain.handle('chat:sessions:list', async (_event, contextMeta: ChatContextMeta) => {
    return listChatSessions(contextMeta)
  })

  ipcMain.handle('chat:sessions:save', async (_event, params: SaveChatSessionParams) => {
    return saveChatSession(params)
  })

  ipcMain.handle('chat:sessions:load', async (_event, sessionId: string) => {
    return loadChatSession(sessionId)
  })

  ipcMain.handle('chat:sessions:archive', async (_event, sessionId: string) => {
    return archiveChatSession(sessionId)
  })

  // ─── Shell ───
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    // Only allow http/https URLs for security
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url)
    }
  })
}
