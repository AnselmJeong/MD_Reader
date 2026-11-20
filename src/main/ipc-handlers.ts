import { getSubscriptionStatus, subscriptionAction } from './subscription-client'
import type { SubscriptionProvider } from '../shared/subscription'
import { readDocumentImage } from './document-image-service'
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import path from 'node:path'
import { listCommentary, saveCommentary, setCommentaryDeleted, importCommentaryImage, importCommentaryImageData, importCommentaryHtml, commentaryDeletionPlan, permanentlyDeleteCommentary } from './commentary-service'
import { exportCommentaryEpub, commentaryExportPath } from './commentary-epub'
import {
  getCoachImage, createCoachSelectionCard, getCoachUserDeck, searchCoachImages, saveCoachImage, getCoachPreferences, getCoachProfile, getCoachSettings, getCoachUsage, recordCoachEvent,
  requestCoachDeck, resetCoachProfile, setCoachChatBusyProbe, setCoachPreferences, setCoachSettings,
  addCoachReviews, answerCoachReview, getCoachLinks, getCoachMemoryLinks, getDueCoachReviews, getOpenedCards,
  exportCoachArchive
} from './coach-service'
import type { CoachDeckRequest, CoachEvent, CoachImageCandidate, CoachSelectionCardRequest, CoachLinksRequest, CoachPreferences, CoachReviewRequest, CoachSettings } from '../shared/coach'
import type { SaveCommentary } from '../shared/commentary'
import { readDocumentFile, getRecentFiles, addRecentFile, writeFileContent, setDocumentBibliography } from './file-service'
import { listModels, generateChatTitle } from './ai-service'
import { getModelVisionInfo } from './model-vision-service'
import { validateChatImageMessages, writeChatExport } from './chat-image-service'
import { imageModelWarning, type ChatImage } from '../shared/chat-images'
import { getAiProviderStatus, updateAiProviderSettings, AiProviderSettingsUpdate } from './ai-provider-settings'
import { streamGroundedChat, type StreamGroundedChatParams } from './ai-chat-service'
import { getSettings, setSettings } from './settings-service'
import { listKoreanSystemFonts } from './system-font-service'
import {
  archiveChatSession,
  ChatContextMeta,
  listChatSessions,
  loadChatSession,
  SaveChatSessionParams,
  saveChatSession
} from './chat-session-service'
import {
  buildMemoryContextForPrompt,
  getAgentMemoryStatus,
  openAgentMemoryFolder,
  processSessionMemory,
  queueMemoryExtraction
} from './agent-memory-service'
import { AgentMemorySettings, connectAgentMemorySettings } from './agent-memory-settings'
import {
  deleteEpubAnnotation,
  DeleteEpubAnnotationParams,
  listEpubAnnotations,
  ListEpubAnnotationsParams,
  saveEpubAnnotation,
  SaveEpubAnnotationParams
} from './epub-annotation-service'
import {
  getEpubReadingProgress,
  GetEpubReadingProgressParams,
  saveEpubReadingProgress,
  SaveEpubReadingProgressParams
} from './epub-reading-progress-service'

const activeAiRequests = new Map<number, AbortController>()

export function registerIpcHandlers(): void {
  const escapeHandlers = new WeakMap<Electron.WebContents, (event: Electron.Event, input: Electron.Input) => void>()
  ipcMain.on('commentary:escape-listening', (event, enabled: boolean) => {
    const contents = event.sender
    const previous = escapeHandlers.get(contents)
    if (previous) contents.removeListener('before-input-event', previous)
    escapeHandlers.delete(contents)
    if (enabled !== true) return
    const handler = (keyEvent: Electron.Event, input: Electron.Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        keyEvent.preventDefault()
        contents.send('commentary:escape')
      }
    }
    escapeHandlers.set(contents, handler)
    contents.on('before-input-event', handler)
  })
  ipcMain.handle('commentary:list', (_event, documentId: string) => listCommentary(documentId))
  ipcMain.handle('commentary:save', (_event, params: SaveCommentary) => saveCommentary(params))
  ipcMain.handle('commentary:deleted', (_event, documentId: string, id: string, deleted: boolean) => setCommentaryDeleted(documentId, id, deleted))
  ipcMain.handle('commentary:html', async () => {
    const result = await dialog.showOpenDialog({ title: '주석에 HTML 추가', properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] })
    return result.canceled || !result.filePaths[0] ? null : importCommentaryHtml(result.filePaths[0])
  })
  ipcMain.handle('commentary:permanently-delete', async (event, documentId: string, id: string, expectedUpdatedAt: number) => {
    const plan = commentaryDeletionPlan(documentId, id, expectedUpdatedAt)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('주석 창을 찾을 수 없습니다.')
    const result = await dialog.showMessageBox(win, {
      type: 'warning', title: '주석 완전 삭제',
      message: plan.removed.length > 1 ? `이 주석과 답글 ${plan.removed.length - 1}개를 완전히 삭제할까요?` : '이 주석을 완전히 삭제할까요?',
      detail: '이 기기에서 복원할 수 없습니다. 이전에 내보낸 EPUB 사본은 변경되지 않습니다.',
      buttons: ['취소', '완전 삭제'], defaultId: 0, cancelId: 0, noLink: true
    })
    if (result.response !== 1) return false
    permanentlyDeleteCommentary(documentId, id, expectedUpdatedAt, plan.revision)
    return true
  })
  ipcMain.handle('commentary:image', async (_event, documentId: string) => {
    const result = await dialog.showOpenDialog({ title: '주석에 그림 추가', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    return result.canceled || !result.filePaths[0] ? null : importCommentaryImage(documentId, result.filePaths[0])
  })
  ipcMain.handle('commentary:image-data', (_event, documentId: string, dataUrl: string, name: string) => importCommentaryImageData(documentId, dataUrl, name))
  // ─── Reading coach (separate from ai:chat so background work never cancels a question) ───
  setCoachChatBusyProbe(() => activeAiRequests.size > 0)
  ipcMain.handle('coach:preferences:get', (_event, documentId: string) => getCoachPreferences(documentId))
  ipcMain.handle('coach:preferences:set', (_event, documentId: string, preferences: CoachPreferences) => setCoachPreferences(documentId, preferences))
  ipcMain.handle('coach:settings:get', () => getCoachSettings())
  ipcMain.handle('coach:settings:set', (_event, partial: Partial<CoachSettings>) => setCoachSettings(partial))
  ipcMain.handle('coach:deck', (_event, request: CoachDeckRequest) => requestCoachDeck(request))
  ipcMain.handle('coach:event', (_event, event: CoachEvent) => recordCoachEvent(event))
  ipcMain.handle('coach:profile', () => getCoachProfile())
  ipcMain.handle('coach:profile:reset', () => resetCoachProfile())
  ipcMain.handle('coach:usage', () => getCoachUsage())
  ipcMain.handle('coach:image', (_event, card: { title: string; imageQuery?: string }) => getCoachImage(card))
  ipcMain.handle('coach:selection-card', (_event, request: CoachSelectionCardRequest) => createCoachSelectionCard(request))
  ipcMain.handle('coach:user-deck', (_event, documentId: string, chapterHref: string) => getCoachUserDeck(documentId, chapterHref))
  ipcMain.handle('coach:image:search', (_event, query: string) => searchCoachImages(query))
  ipcMain.handle('coach:image:save', (_event, card: { title: string; imageQuery?: string }, candidate: CoachImageCandidate) => saveCoachImage(card, candidate))
  ipcMain.handle('coach:links', (_event, request: CoachLinksRequest) => getCoachLinks(request))
  ipcMain.handle('coach:memory-links', (_event, request: CoachLinksRequest) => getCoachMemoryLinks(request))
  ipcMain.handle('coach:opened', (_event, documentId: string, chapterHref: string) => getOpenedCards(documentId, chapterHref))
  ipcMain.handle('coach:reviews:add', (_event, request: CoachReviewRequest) => addCoachReviews(request))
  ipcMain.handle('coach:reviews:due', () => getDueCoachReviews())
  ipcMain.handle('coach:reviews:answer', (_event, id: string, remembered: boolean) => answerCoachReview(id, remembered))
  ipcMain.handle('commentary:export', async (_event, filePath: string, documentId: string) => {
    const result = await dialog.showSaveDialog({ title: '주석을 포함한 EPUB 저장', defaultPath: commentaryExportPath(filePath), filters: [{ name: 'Quarto', extensions: ['qmd'] },
        { name: 'EPUB', extensions: ['epub'] }] })
    if (result.canceled || !result.filePath) return null
    const coach = exportCoachArchive(documentId)
    await exportCommentaryEpub(filePath, result.filePath, documentId, coach)
    return { filePath: result.filePath, coachCards: coach.decks.reduce((sum, deck) => sum + deck.cards.length, 0) }
  })
  // ─── File Operations ───
  ipcMain.handle('file:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Readable Documents', extensions: ['md', 'markdown', 'qmd', 'txt', 'epub'] },
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'Quarto', extensions: ['qmd'] },
        { name: 'EPUB', extensions: ['epub'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const document = await readDocumentFile(filePath)
    await addRecentFile(filePath)
    return document
  })

  ipcMain.handle('file:read-image', (_event, documentPath: string, source: string) => readDocumentImage(documentPath, source))

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const document = await readDocumentFile(filePath)
    await addRecentFile(filePath)
    return document
  })

  ipcMain.handle('file:select-bibliography', async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose bibliography for this document',
      properties: ['openFile'],
      filters: [{ name: 'BibTeX', extensions: ['bib'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return setDocumentBibliography(filePath, result.filePaths[0])
  })

  ipcMain.handle('file:reset-bibliography', async (_event, filePath: string) => {
    return setDocumentBibliography(filePath, null)
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

  // ─── AI ───
  ipcMain.handle('ai:list-models', async () => {
    return listModels()
  })
  ipcMain.handle('ai:model-vision', (_event, model: string) => getModelVisionInfo(model))

  ipcMain.handle('ai:chat', async (event, params: StreamGroundedChatParams) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { error: 'No window found' }
    const controller = new AbortController()
    activeAiRequests.get(event.sender.id)?.abort()
    activeAiRequests.set(event.sender.id, controller)

    try {
      validateChatImageMessages(params.messages)
      if (params.messages.some(message => message.images?.length)) {
        const capability = await getModelVisionInfo(params.model)
        if (capability.vision === 'unsupported') throw new Error(imageModelWarning(params.model, 'unsupported', true))
        controller.signal.throwIfAborted()
      }
      let systemPrompt = params.systemPrompt
      if (params.memoryContext) {
        try {
          const memory = await buildMemoryContextForPrompt(params.memoryContext,
            AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]))
          if (memory.block) {
            systemPrompt = systemPrompt ? `${systemPrompt}\n\n${memory.block}` : memory.block
          }
        } catch (error) {
          console.error('[AgentMemory] Failed to build runtime context:', error)
        }
      }

      const metadata = await streamGroundedChat({ ...params, systemPrompt }, {
        onSearchEnd: () => {
          if (!win.isDestroyed()) win.webContents.send('ai:search-end')
        },
        onSearchStart: (payload) => {
          if (!win.isDestroyed()) {
            win.webContents.send('ai:search-start', payload)
          }
        },
        onSources: (sources) => {
          if (!win.isDestroyed()) {
            win.webContents.send('ai:search-results', { sources })
          }
        },
        onToken: (token: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send('ai:token', token)
          }
        }
      }, controller.signal)
      if (!win.isDestroyed()) {
        win.webContents.send('ai:metadata', metadata)
        win.webContents.send('ai:done', metadata)
      }
      return { success: true }
    } catch (error) {
      if (controller.signal.aborted) {
        if (!win.isDestroyed()) {
          win.webContents.send('ai:stopped')
        }
        return { stopped: true }
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (!win.isDestroyed()) {
        win.webContents.send('ai:error', message)
      }
      return { error: message }
    } finally {
      if (activeAiRequests.get(event.sender.id) === controller) {
        activeAiRequests.delete(event.sender.id)
      }
    }
  })

  ipcMain.handle('ai:stop', async (event) => {
    const controller = activeAiRequests.get(event.sender.id)
    if (!controller) return { success: false }
    controller.abort()
    activeAiRequests.delete(event.sender.id)
    return { success: true }
  })

  ipcMain.handle('ai:generate-title', async (_event, params: {
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

  ipcMain.handle('subscriptions:status', () => getSubscriptionStatus())
  ipcMain.handle('subscriptions:action', (_event, provider: SubscriptionProvider, action: 'login' | 'cancelLogin' | 'logout') => subscriptionAction(provider, action))

  // ─── Settings ───
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    return getSettings(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    setSettings(key, value)
    return { success: true }
  })

  ipcMain.handle('fonts:list-korean', async () => {
    return listKoreanSystemFonts()
  })

  ipcMain.handle('ai-provider:status', async () => {
    return getAiProviderStatus()
  })

  ipcMain.handle('ai-provider:update-settings', async (_event, partial: AiProviderSettingsUpdate) => {
    return updateAiProviderSettings(partial)
  })

  // ─── Chat Export ───
  ipcMain.handle('chat:export', async (_event, markdown: string, images?: ChatImage[]) => {
    const result = await dialog.showSaveDialog({
      defaultPath: `chat-export-${Date.now()}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    await writeChatExport(result.filePath, markdown, images)
    return { success: true, filePath: result.filePath }
  })

  ipcMain.handle('chat:sessions:list', async (_event, contextMeta: ChatContextMeta) => {
    return listChatSessions(contextMeta)
  })

  ipcMain.handle('chat:sessions:save', async (_event, params: SaveChatSessionParams) => {
    const result = saveChatSession(params)
    if (params.processMemory) queueMemoryExtraction(result.sessionId)
    return result
  })

  ipcMain.handle('chat:sessions:load', async (_event, sessionId: string) => {
    return loadChatSession(sessionId)
  })

  ipcMain.handle('chat:sessions:archive', async (_event, sessionId: string) => {
    return archiveChatSession(sessionId)
  })

  ipcMain.handle('agent-memory:status', async () => {
    return getAgentMemoryStatus()
  })

  ipcMain.handle('agent-memory:update-settings', async (_event, partial: Partial<AgentMemorySettings>) => {
    await connectAgentMemorySettings(partial)
    return getAgentMemoryStatus()
  })

  ipcMain.handle('agent-memory:process-session', async (_event, sessionId: string) => {
    await processSessionMemory(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent-memory:open-folder', async () => {
    return openAgentMemoryFolder()
  })

  // ─── EPUB Annotations ───
  ipcMain.handle('epub:annotations:list', async (_event, params: ListEpubAnnotationsParams) => {
    return listEpubAnnotations(params)
  })

  ipcMain.handle('epub:annotations:save', async (_event, params: SaveEpubAnnotationParams) => {
    return saveEpubAnnotation(params)
  })

  ipcMain.handle('epub:annotations:delete', async (_event, params: DeleteEpubAnnotationParams) => {
    return deleteEpubAnnotation(params)
  })

  ipcMain.handle('epub:progress:get', async (_event, params: GetEpubReadingProgressParams) => {
    return getEpubReadingProgress(params)
  })

  ipcMain.handle('epub:progress:save', async (_event, params: SaveEpubReadingProgressParams) => {
    return saveEpubReadingProgress(params)
  })

  // ─── Shell ───
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    // Only allow http/https URLs for security
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url)
    }
  })
}
