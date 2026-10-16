import type { ChatImage } from '../shared/chat-images'

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

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessageInput {
  role: ChatRole | string
  content: string
  images?: ChatImage[]
}
