import { create } from 'zustand'

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
  focusInputRequest: number
  selectedModel: string
  availableModels: string[]
  systemPrompt: string

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateStreamingContent: (token: string) => void
  finalizeStreaming: () => void
  startStreaming: () => void
  clearMessages: () => void
  setSelectedModel: (model: string) => void
  setAvailableModels: (models: string[]) => void
  setSystemPrompt: (prompt: string) => void
  setInputDraft: (text: string) => void
  requestInputFocus: () => void
  sendMessage: (params: {
    text: string
    documentContent?: string | null
    quotedText?: string
  }) => Promise<{ success: boolean; reason?: string }>
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  inputDraft: '',
  focusInputRequest: 0,
  selectedModel: '',
  availableModels: [],
  systemPrompt:
    'You are a knowledgeable academic assistant. Use your comprehensive knowledge base to answer questions, incorporating the provided document as context. feel free to integrate external knowledge, theoretical frameworks, and related concepts to provide rich, well-rounded answers. Do not limit yourself to the document content only.',

  addMessage: (message) => {
    const id = `msg-${++messageCounter}-${Date.now()}`
    set((state) => ({
      messages: [...state.messages, { ...message, id, timestamp: Date.now() }]
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
        streamingContent: ''
      }))
    } else {
      set({ isStreaming: false, streamingContent: '' })
    }
  },

  clearMessages: () => set({ messages: [], streamingContent: '' }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  setInputDraft: (text) => set({ inputDraft: text }),
  requestInputFocus: () => set((state) => ({ focusInputRequest: state.focusInputRequest + 1 })),
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
      inputDraft: ''
    }))

    const chatMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
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
            content: `⚠️ Error: ${errMessage}`,
            timestamp: Date.now()
          }
        ]
      }))
      return { success: false, reason: 'send-failed' }
    }
  }
}))
