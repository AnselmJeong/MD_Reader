import { create } from 'zustand'
import { normalizeThinkingLevel, type ThinkingLevel } from '../../../shared/chat-request-options'
import type {
  ChatContextMeta,
  ChatSource,
  ChatSessionSummary,
  SessionTitleStatus,
  StoredChatMessage
} from '../global'
import { DEFAULT_AI_SYSTEM_PROMPT, resolveAiSystemPrompt } from '../../../shared/ai-prompts'
import { validateChatImages, chatImageBytes, imageModelWarning, MAX_CHAT_REQUEST_IMAGE_BYTES, type ChatImage, type ModelVisionInfo } from '../../../shared/chat-images'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  quotedText?: string
  sources?: ChatSource[]
  images?: ChatImage[]
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  streamingSources: ChatSource[]
  streamingSearchQuery: string | null
  inputDraft: string
  webSearch: boolean
  thinkingLevel: ThinkingLevel
  pendingQuotedText: string | null
  pendingImages: ChatImage[]
  modelVision: ModelVisionInfo | null
  isCheckingVision: boolean
  isPreparingMessage: boolean
  sendWarning: string | null
  focusInputRequest: number
  selectedModel: string
  availableModels: string[]
  systemPrompt: string
  currentContextMeta: ChatContextMeta | null
  currentProposedContextKey: string | null
  currentContextKey: string | null
  currentSessionId: string | null
  availableSessions: ChatSessionSummary[]
  sessionTitle: string | null
  titleStatus: SessionTitleStatus
  sessionDirty: boolean
  sessionView: 'live' | 'historical'
  isLoadingSession: boolean

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateStreamingContent: (token: string) => void
  setStreamingSearchQuery: (query: string | null) => void
  setStreamingSources: (sources: ChatSource[]) => void
  finalizeStreaming: () => void
  cancelStreaming: () => void
  startStreaming: () => void
  clearMessages: () => void
  setSelectedModel: (model: string) => void
  setAvailableModels: (models: string[]) => void
  setSystemPrompt: (prompt: string, persist?: boolean) => void
  setInputDraft: (text: string) => void
  setWebSearch: (enabled: boolean) => void
  setThinkingLevel: (level: ThinkingLevel) => void
  setPendingQuotedText: (text: string | null) => void
  setPendingImages: (images: ChatImage[]) => void
  refreshModelVision: () => Promise<ModelVisionInfo>
  requestInputFocus: () => void
  switchContext: (contextMeta: ChatContextMeta | null, proposedContextKey: string | null) => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  startNewSession: () => Promise<void>
  saveCurrentSession: (options?: { finalizeTitle?: boolean; refreshSessions?: boolean; processMemory?: boolean }) => Promise<void>
  stopStreaming: () => Promise<void>
  sendMessage: (params: {
    text: string
    documentContent?: string | null
    quotedText?: string
  }) => Promise<{ success: boolean; reason?: string }>
}

let messageCounter = 0
let contextSwitchRequest = 0

const persistSetting = (key: string, value: unknown) => {
  void window.api.settings.set(key, value)
}

function getFallbackTitle(messages: ChatMessage[], contextTitle?: string): string {
  const firstQuestion = messages.find((message) => message.role === 'user')?.content.trim()
  if (firstQuestion) {
    return firstQuestion.length > 48 ? `${firstQuestion.slice(0, 48)}...` : firstQuestion
  }
  return `${contextTitle || 'Reading'} session`
}

function toStoredMessages(messages: ChatMessage[]): StoredChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    quotedText: message.quotedText ?? null,
    sources: message.sources ?? [],
    images: message.images ?? []
  }))
}

function fromStoredMessages(messages: StoredChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    quotedText: message.quotedText ?? undefined,
    sources: message.sources ?? [],
    images: message.images ?? []
  }))
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  streamingSources: [],
  streamingSearchQuery: null,
  inputDraft: '',
  pendingQuotedText: null,
  pendingImages: [],
  webSearch: false,
  thinkingLevel: 'none',
  modelVision: null,
  isCheckingVision: false,
  isPreparingMessage: false,
  sendWarning: null,
  focusInputRequest: 0,
  selectedModel: '',
  availableModels: [],
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  currentContextMeta: null,
  currentProposedContextKey: null,
  currentContextKey: null,
  currentSessionId: null,
  availableSessions: [],
  sessionTitle: null,
  titleStatus: 'pending',
  sessionDirty: false,
  sessionView: 'live',
  isLoadingSession: false,

  addMessage: (message) => {
    const id = `msg-${++messageCounter}-${Date.now()}`
    set((state) => ({
      messages: [...state.messages, { ...message, id, timestamp: Date.now() }],
      sessionDirty: true,
      sessionView: 'live'
    }))
  },

  startStreaming: () => set({ isStreaming: true, streamingContent: '', streamingSources: [], streamingSearchQuery: null }),

  updateStreamingContent: (token) =>
    set((state) => ({ streamingContent: state.streamingContent + token })),

  setStreamingSearchQuery: (query) => set({ streamingSearchQuery: query }),
  setStreamingSources: (sources) => set({ streamingSources: sources }),

  finalizeStreaming: () => {
    const { streamingContent, streamingSources } = get()
    if (streamingContent) {
      const id = `msg-${++messageCounter}-${Date.now()}`
      set((state) => ({
        messages: [
          ...state.messages,
          { id, role: 'assistant', content: streamingContent, timestamp: Date.now(), sources: streamingSources }
        ],
        isStreaming: false,
        streamingContent: '',
        streamingSources: [],
        streamingSearchQuery: null,
        sessionDirty: true,
        sessionView: 'live'
      }))
    } else {
      set({ isStreaming: false, streamingContent: '', streamingSources: [], streamingSearchQuery: null })
    }
  },
  cancelStreaming: () => set({
    isStreaming: false,
    streamingContent: '',
    streamingSources: [],
    streamingSearchQuery: null
  }),

  clearMessages: () => set({
    messages: [],
    streamingContent: '',
    streamingSources: [],
    streamingSearchQuery: null,
    pendingQuotedText: null,
    pendingImages: [],
    webSearch: false,
    thinkingLevel: 'none',
    sendWarning: null,
    currentSessionId: null,
    sessionTitle: null,
    titleStatus: 'pending',
    sessionDirty: false,
    sessionView: 'live'
  }),
  setSelectedModel: (model) => {
    set({ selectedModel: model, modelVision: null, isCheckingVision: false, sendWarning: null })
    persistSetting('aiModel', model)
  },
  setAvailableModels: (models) => set({ availableModels: models }),
  setSystemPrompt: (prompt, persist = true) => {
    set({ systemPrompt: prompt })
    if (persist) persistSetting('systemPrompt', prompt)
  },
  setInputDraft: (text) => set({ inputDraft: text }),
  setWebSearch: (enabled) => set({ webSearch: enabled }),
  setThinkingLevel: (level) => set({ thinkingLevel: normalizeThinkingLevel(level) }),
  setPendingQuotedText: (text) => set({ pendingQuotedText: text?.trim() ? text.trim() : null }),
  setPendingImages: (images) => set({ pendingImages: validateChatImages(images), sendWarning: null }),
  refreshModelVision: async () => {
    const model = get().selectedModel
    set({ isCheckingVision: true })
    let info: ModelVisionInfo
    try { info = await window.api.ai.modelVision(model) }
    catch { info = { model, vision: 'unknown' } }
    if (get().selectedModel === model) set({ modelVision: info, isCheckingVision: false })
    return info
  },
  requestInputFocus: () => set((state) => ({ focusInputRequest: state.focusInputRequest + 1 })),
  saveCurrentSession: async (options) => {
    const {
      currentContextMeta,
      currentSessionId,
      messages,
      selectedModel,
      systemPrompt,
      sessionTitle,
      titleStatus,
      isStreaming
    } = get()

    if (!currentContextMeta || messages.length === 0 || isStreaming) return

    let title = sessionTitle || getFallbackTitle(messages, currentContextMeta.contextTitle)
    let nextTitleStatus: SessionTitleStatus = sessionTitle ? titleStatus : 'fallback'

    if (options?.finalizeTitle && selectedModel && nextTitleStatus !== 'generated') {
      try {
        const result = await window.api.ai.generateTitle({
          model: selectedModel,
          contextTitle: currentContextMeta.contextTitle,
          messages: messages.map((message) => ({ role: message.role, content: message.content }))
        })
        if (result.success && result.title?.trim()) {
          title = result.title.trim()
          nextTitleStatus = 'generated'
        }
      } catch (error) {
        console.error('Failed to generate session title:', error)
      }
    }

    try {
      const result = await window.api.chat.saveSession({
        sessionId: currentSessionId,
        contextMeta: currentContextMeta,
        title,
        titleStatus: nextTitleStatus,
        model: selectedModel || null,
        systemPrompt,
        messages: toStoredMessages(messages),
        processMemory: options?.processMemory ?? options?.finalizeTitle === true
      })
      const refreshed = options?.refreshSessions === false
        ? null
        : await window.api.chat.listSessions(currentContextMeta)
      set({
        currentSessionId: result.sessionId,
        currentContextKey: result.contextKey,
        ...(refreshed ? { availableSessions: refreshed.sessions } : {}),
        sessionTitle: result.title,
        titleStatus: nextTitleStatus,
        sessionDirty: false
      })
    } catch (error) {
      console.error('Failed to save chat session:', error)
    }
  },
  switchContext: async (contextMeta, proposedContextKey) => {
    const state = get()
    if (state.currentProposedContextKey === proposedContextKey) return
    if (state.isStreaming) return
    const requestId = ++contextSwitchRequest

    await state.saveCurrentSession({ finalizeTitle: false, refreshSessions: false, processMemory: true })
    if (requestId !== contextSwitchRequest) return

    if (!contextMeta || !proposedContextKey) {
      if (requestId !== contextSwitchRequest) return
      set({
        currentContextMeta: null,
        currentProposedContextKey: null,
        currentContextKey: null,
        currentSessionId: null,
        availableSessions: [],
        sessionTitle: null,
        titleStatus: 'pending',
        messages: [],
        streamingContent: '',
        streamingSources: [],
        streamingSearchQuery: null,
        pendingQuotedText: null,
        pendingImages: [],
        webSearch: false,
        thinkingLevel: 'none',
        sendWarning: null,
        sessionDirty: false,
        sessionView: 'live'
      })
      return
    }

    set({ isLoadingSession: true })
    try {
      const result = await window.api.chat.listSessions(contextMeta)
      if (requestId !== contextSwitchRequest) return
      set({
        currentContextMeta: contextMeta,
        currentProposedContextKey: proposedContextKey,
        currentContextKey: result.contextKey,
        currentSessionId: null,
        availableSessions: result.sessions,
        sessionTitle: null,
        titleStatus: 'pending',
        messages: [],
        streamingContent: '',
        streamingSources: [],
        streamingSearchQuery: null,
        pendingQuotedText: null,
        pendingImages: [],
        webSearch: false,
        thinkingLevel: 'none',
        sendWarning: null,
        sessionDirty: false,
        sessionView: 'live',
        isLoadingSession: false
      })
    } catch (error) {
      console.error('Failed to load chat sessions:', error)
      if (requestId !== contextSwitchRequest) return
      set({
        currentContextMeta: contextMeta,
        currentProposedContextKey: proposedContextKey,
        currentContextKey: null,
        currentSessionId: null,
        availableSessions: [],
        messages: [],
        streamingSources: [],
        streamingSearchQuery: null,
        pendingQuotedText: null,
        pendingImages: [],
        webSearch: false,
        thinkingLevel: 'none',
        sendWarning: null,
        sessionDirty: false,
        sessionView: 'live',
        isLoadingSession: false
      })
    }
  },
  loadSession: async (sessionId) => {
    contextSwitchRequest += 1
    const state = get()
    if (state.currentSessionId === sessionId && state.sessionView === 'historical') return

    await state.saveCurrentSession({ finalizeTitle: true })

    set({ isLoadingSession: true })
    try {
      const result = await window.api.chat.loadSession(sessionId)
      if (!result) {
        set({ isLoadingSession: false })
        return
      }
      set({
        currentSessionId: result.session.id,
        currentContextKey: result.session.contextKey,
        sessionTitle: result.session.title,
        titleStatus: result.session.titleStatus,
        systemPrompt: resolveAiSystemPrompt(result.session.systemPrompt),
        messages: fromStoredMessages(result.messages),
        streamingContent: '',
        streamingSources: [],
        streamingSearchQuery: null,
        pendingQuotedText: null,
        pendingImages: [],
        webSearch: false,
        thinkingLevel: 'none',
        sendWarning: null,
        sessionDirty: false,
        sessionView: 'historical',
        isLoadingSession: false
      })
    } catch (error) {
      console.error('Failed to load chat session:', error)
      set({ isLoadingSession: false })
    }
  },
  startNewSession: async () => {
    contextSwitchRequest += 1
    const state = get()
    const previous = {
      currentContextMeta: state.currentContextMeta,
      currentSessionId: state.currentSessionId,
      messages: state.messages,
      selectedModel: state.selectedModel,
      systemPrompt: state.systemPrompt,
      sessionTitle: state.sessionTitle,
      titleStatus: state.titleStatus
    }

    const currentContextMeta = state.currentContextMeta

    set({
      currentSessionId: null,
      sessionTitle: null,
      titleStatus: 'pending',
      messages: [],
      streamingContent: '',
      streamingSources: [],
      streamingSearchQuery: null,
      inputDraft: '',
      pendingQuotedText: null,
      pendingImages: [],
      webSearch: false,
      thinkingLevel: 'none',
      sendWarning: null,
      sessionDirty: false,
      sessionView: 'live'
    })

    if (previous.currentContextMeta && previous.messages.length > 0) {
      try {
        await window.api.chat.saveSession({
          sessionId: previous.currentSessionId,
          contextMeta: previous.currentContextMeta,
          title: previous.sessionTitle || getFallbackTitle(previous.messages, previous.currentContextMeta.contextTitle),
          titleStatus: previous.sessionTitle ? previous.titleStatus : 'fallback',
          model: previous.selectedModel || null,
          systemPrompt: previous.systemPrompt,
          messages: toStoredMessages(previous.messages),
          processMemory: true
        })
        const refreshed = currentContextMeta
          ? await window.api.chat.listSessions(currentContextMeta)
          : null
        set((latest) => ({
          availableSessions: refreshed?.sessions ?? latest.availableSessions,
          currentContextKey: refreshed?.contextKey ?? latest.currentContextKey
        }))
      } catch (error) {
        console.error('Failed to save previous chat session:', error)
      }
    }
  },
  stopStreaming: async () => {
    try {
      await window.api.ai.stop()
    } catch (error) {
      console.error('Failed to stop AI response:', error)
    }
    set({ isStreaming: false, streamingContent: '', streamingSources: [], streamingSearchQuery: null })
  },
  sendMessage: async ({ text, documentContent, quotedText }) => {
    const images = get().pendingImages
    const message = text.trim() || (images.length ? '첨부한 이미지를 설명해 주세요.' : '')
    if (!message) return { success: false, reason: 'empty' }

    const { selectedModel, isStreaming, isPreparingMessage, messages, systemPrompt, currentContextMeta, webSearch, thinkingLevel } = get()
    if (!selectedModel) return { success: false, reason: 'no-model' }
    if (isStreaming || isPreparingMessage) return { success: false, reason: 'streaming' }

    const historicalImages = messages.flatMap(item => item.images ?? [])
    if (images.length || historicalImages.length) {
      set({ isPreparingMessage: true, sendWarning: null })
      try {
        validateChatImages(images)
        if ([...historicalImages, ...images].reduce((total, image) => total + chatImageBytes(image.dataUrl), 0) > MAX_CHAT_REQUEST_IMAGE_BYTES) {
          throw new Error('이 대화의 이미지가 30MB를 초과합니다. 새 대화에서 질문해 주세요.')
        }
        const info = await get().refreshModelVision()
        if (get().selectedModel !== selectedModel || get().messages !== messages || get().currentContextMeta !== currentContextMeta) {
          return { success: false, reason: 'context-changed' }
        }
        if (info.vision === 'unsupported') {
          set({ sendWarning: imageModelWarning(selectedModel, info.vision, historicalImages.length > 0) })
          return { success: false, reason: 'non-vision-model' }
        }
      } catch (error) {
        set({ sendWarning: error instanceof Error ? error.message : '첨부 이미지를 확인해 주세요.' })
        return { success: false, reason: 'invalid-images' }
      } finally { set({ isPreparingMessage: false }) }
    }

    const id = `msg-${++messageCounter}-${Date.now()}`
    const userMessage: ChatMessage = {
      id,
      role: 'user',
      content: message,
      quotedText,
      images,
      timestamp: Date.now()
    }

    set((state) => ({
      messages: [...state.messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      streamingSources: [],
      streamingSearchQuery: null,
      inputDraft: '',
      pendingQuotedText: null,
      pendingImages: [],
      webSearch: false,
      thinkingLevel: 'none',
      sendWarning: null,
      sessionDirty: true,
      sessionView: 'live'
    }))

    const outgoingUserContent = quotedText
      ? `Selected passage:\n\n${quotedText}\n\nQuestion:\n\n${message}`
      : message

    const chatMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content, images: m.images })),
      { role: 'user' as const, content: outgoingUserContent, images }
    ]

    let fullSystemPrompt = systemPrompt
    if (documentContent) {
      fullSystemPrompt += `\n\n---\n\nHere is the document the user is reading:\n\n${documentContent}`
    }

    try {
      await window.api.ai.chat({
        model: selectedModel,
        messages: chatMessages,
        webSearch,
        thinkingLevel,
        systemPrompt: fullSystemPrompt,
        memoryContext: {
          userText: message,
          contextTitle: currentContextMeta?.contextTitle ?? null,
          quotedText: quotedText ?? null
        }
      })
      return { success: true }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Failed to send message'
      set((state) => ({
        isStreaming: false,
        streamingContent: '',
        messages: [
          ...state.messages,
          {
            id: `msg-${++messageCounter}-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${errMessage}`,
            timestamp: Date.now()
          }
        ],
        streamingSources: [],
        streamingSearchQuery: null,
        sessionDirty: true,
        sessionView: 'live'
      }))
      return { success: false, reason: 'send-failed' }
    }
  }
}))
