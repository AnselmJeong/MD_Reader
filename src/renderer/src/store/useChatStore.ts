import { create } from 'zustand'
import type {
  ChatContextMeta,
  ChatSource,
  ChatSessionSummary,
  SessionTitleStatus,
  StoredChatMessage
} from '../global'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  quotedText?: string
  sources?: ChatSource[]
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  streamingSources: ChatSource[]
  streamingSearchQuery: string | null
  inputDraft: string
  pendingQuotedText: string | null
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
  setSystemPrompt: (prompt: string) => void
  setInputDraft: (text: string) => void
  setPendingQuotedText: (text: string | null) => void
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
    sources: message.sources ?? []
  }))
}

function fromStoredMessages(messages: StoredChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    quotedText: message.quotedText ?? undefined,
    sources: message.sources ?? []
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
  focusInputRequest: 0,
  selectedModel: '',
  availableModels: [],
  systemPrompt:
    'You are a careful academic reading assistant. Answer in Korean.\n\nUse the provided document context first. When web sources are provided, use them to verify current or external factual claims and cite them with [S1], [S2] markers. If the provided document or sources do not support a claim, say so clearly instead of guessing.\n\nKeep answers precise, distinguish document evidence from web evidence, and avoid inventing citations.',
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
    currentSessionId: null,
    sessionTitle: null,
    titleStatus: 'pending',
    sessionDirty: false,
    sessionView: 'live'
  }),
  setSelectedModel: (model) => {
    set({ selectedModel: model })
    persistSetting('ollamaModel', model)
  },
  setAvailableModels: (models) => set({ availableModels: models }),
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  setInputDraft: (text) => set({ inputDraft: text }),
  setPendingQuotedText: (text) => set({ pendingQuotedText: text?.trim() ? text.trim() : null }),
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
        const result = await window.api.ollama.generateTitle({
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
        messages: fromStoredMessages(result.messages),
        streamingContent: '',
        streamingSources: [],
        streamingSearchQuery: null,
        pendingQuotedText: null,
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
      await window.api.ollama.stop()
    } catch (error) {
      console.error('Failed to stop Ollama response:', error)
    }
    set({ isStreaming: false, streamingContent: '', streamingSources: [], streamingSearchQuery: null })
  },
  sendMessage: async ({ text, documentContent, quotedText }) => {
    const message = text.trim()
    if (!message) return { success: false, reason: 'empty' }

    const { selectedModel, isStreaming, messages, systemPrompt, currentContextMeta } = get()
    if (!selectedModel) return { success: false, reason: 'no-model' }
    if (isStreaming) return { success: false, reason: 'streaming' }

    const id = `msg-${++messageCounter}-${Date.now()}`
    const userMessage: ChatMessage = {
      id,
      role: 'user',
      content: message,
      quotedText,
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
      sessionDirty: true,
      sessionView: 'live'
    }))

    const outgoingUserContent = quotedText
      ? `Selected passage:\n\n${quotedText}\n\nQuestion:\n\n${message}`
      : message

    const chatMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: outgoingUserContent }
    ]

    let fullSystemPrompt = systemPrompt
    if (documentContent) {
      fullSystemPrompt += `\n\n---\n\nHere is the document the user is reading:\n\n${documentContent}`
    }

    try {
      await window.api.ollama.chat({
        model: selectedModel,
        messages: chatMessages,
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
