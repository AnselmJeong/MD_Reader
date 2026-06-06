import { create } from 'zustand'
import type {
  ChatContextMeta,
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
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
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
  saveCurrentSession: (options?: { finalizeTitle?: boolean }) => Promise<void>
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
    quotedText: message.quotedText ?? null
  }))
}

function fromStoredMessages(messages: StoredChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    quotedText: message.quotedText ?? undefined
  }))
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  inputDraft: '',
  pendingQuotedText: null,
  focusInputRequest: 0,
  selectedModel: '',
  availableModels: [],
  systemPrompt:
    'You are a knowledgeable academic assistant. Use your comprehensive knowledge base to answer questions, incorporating the provided document as context. feel free to integrate external knowledge, theoretical frameworks, and related concepts to provide rich, well-rounded answers. Do not limit yourself to the document content only.\nMake sure to Answer in Korean Language',
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

  startStreaming: () => set({ isStreaming: true, streamingContent: '' }),

  updateStreamingContent: (token) =>
    set((state) => ({ streamingContent: state.streamingContent + token })),

  finalizeStreaming: () => {
    const { streamingContent } = get()
    if (streamingContent) {
      const id = `msg-${++messageCounter}-${Date.now()}`
      set((state) => ({
        messages: [
          ...state.messages,
          { id, role: 'assistant', content: streamingContent, timestamp: Date.now() }
        ],
        isStreaming: false,
        streamingContent: '',
        sessionDirty: true,
        sessionView: 'live'
      }))
    } else {
      set({ isStreaming: false, streamingContent: '' })
    }
  },
  cancelStreaming: () => set({
    isStreaming: false,
    streamingContent: ''
  }),

  clearMessages: () => set({
    messages: [],
    streamingContent: '',
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
        messages: toStoredMessages(messages)
      })
      const refreshed = await window.api.chat.listSessions(currentContextMeta)
      set({
        currentSessionId: result.sessionId,
        currentContextKey: result.contextKey,
        availableSessions: refreshed.sessions,
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

    await state.saveCurrentSession({ finalizeTitle: true })
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
    await state.saveCurrentSession({ finalizeTitle: true })

    const currentContextMeta = get().currentContextMeta
    if (currentContextMeta) {
      try {
        const result = await window.api.chat.listSessions(currentContextMeta)
        set({ availableSessions: result.sessions, currentContextKey: result.contextKey })
      } catch (error) {
        console.error('Failed to refresh chat sessions:', error)
      }
    }

    set({
      currentSessionId: null,
      sessionTitle: null,
      titleStatus: 'pending',
      messages: [],
      streamingContent: '',
      inputDraft: '',
      pendingQuotedText: null,
      sessionDirty: false,
      sessionView: 'live'
    })
  },
  stopStreaming: async () => {
    try {
      await window.api.ollama.stop()
    } catch (error) {
      console.error('Failed to stop Ollama response:', error)
    }
    set({ isStreaming: false, streamingContent: '' })
  },
  sendMessage: async ({ text, documentContent, quotedText }) => {
    const message = text.trim()
    if (!message) return { success: false, reason: 'empty' }

    const { selectedModel, isStreaming, messages, systemPrompt } = get()
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
        systemPrompt: fullSystemPrompt
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
        sessionDirty: true,
        sessionView: 'live'
      }))
      return { success: false, reason: 'send-failed' }
    }
  }
}))
