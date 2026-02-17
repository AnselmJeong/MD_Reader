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
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
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
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt })
}))
