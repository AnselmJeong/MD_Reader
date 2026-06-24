import { getAiProviderConfig } from './ai-provider-settings'
import { chatCompletionsStream } from './ollama-openai-client'
import { webSearch } from './ollama-web-search-service'
import type { ChatCompletionMetadata, ChatMessageInput, ChatSource } from './ai-chat-types'

export interface StreamGroundedChatParams {
  model: string
  messages: ChatMessageInput[]
  systemPrompt?: string
  memoryContext?: {
    userText: string
    contextTitle?: string | null
    quotedText?: string | null
  }
}

export interface StreamGroundedChatCallbacks {
  onSearchStart?: (payload: { query: string }) => void
  onSources?: (sources: ChatSource[]) => void
  onToken: (token: string) => void
  onDone?: (metadata: ChatCompletionMetadata) => void
}

const FORCE_SEARCH_PATTERN = /\b(latest|recent|today|current|news|web|search|source|sources|citation|cite|202[0-9]|version|release)\b|출처|검색|최신|최근|오늘|현재|근거|인용|웹|링크|자료/i
const DOCUMENT_LOCAL_PATTERN = /\b(summarize|summary|translate|explain|rewrite|edit|paraphrase|selected passage|this paragraph|this sentence)\b|요약|번역|설명|고쳐|다듬|이 문장|이 문단|이 구절|선택한|발췌/i

function getLastUserText(params: StreamGroundedChatParams): string {
  return params.memoryContext?.userText || [...params.messages].reverse().find((message) => message.role === 'user')?.content || ''
}

export function shouldRunWebSearch(params: StreamGroundedChatParams): boolean {
  const config = getAiProviderConfig()
  if (!config.webSearchEnabled || !config.ollamaApiKey) return false

  const userText = getLastUserText(params)
  const force = FORCE_SEARCH_PATTERN.test(userText)
  if (force) return true

  if (params.memoryContext?.quotedText && DOCUMENT_LOCAL_PATTERN.test(userText)) return false
  return true
}

export function buildSearchQuery(params: StreamGroundedChatParams): string {
  const userText = getLastUserText(params).replace(/\s+/g, ' ').trim()
  const title = params.memoryContext?.contextTitle?.replace(/\s+/g, ' ').trim()
  const quote = params.memoryContext?.quotedText?.replace(/\s+/g, ' ').trim()
  const parts = [userText]
  if (title) parts.push(`context: ${title}`)
  if (quote && FORCE_SEARCH_PATTERN.test(userText)) parts.push(`selected passage: ${quote.slice(0, 220)}`)
  return parts.join(' ').slice(0, 500)
}

function buildSourceBlock(sources: ChatSource[]): string {
  if (sources.length === 0) return ''
  const lines = sources.map((source) => {
    const snippet = source.snippet ? `\nExcerpt: ${source.snippet}` : ''
    return `[${source.id}] ${source.title}\nURL: ${source.url}${snippet}`
  })
  return [
    'Web sources available for this answer:',
    ...lines,
    '',
    'Use these web sources only for claims they support. Cite supported external claims with [S1], [S2] markers. If the sources do not support a claim, say so clearly.'
  ].join('\n\n')
}

function buildMessages(params: StreamGroundedChatParams, sources: ChatSource[]): ChatMessageInput[] {
  const messages = [...params.messages]
  const sourceBlock = buildSourceBlock(sources)
  const systemPrompt = [params.systemPrompt, sourceBlock].filter(Boolean).join('\n\n---\n\n')

  if (systemPrompt) {
    return [{ role: 'system', content: systemPrompt }, ...messages]
  }
  return messages
}

export async function streamGroundedChat(
  params: StreamGroundedChatParams,
  callbacks: StreamGroundedChatCallbacks,
  signal?: AbortSignal
): Promise<ChatCompletionMetadata> {
  const config = getAiProviderConfig()
  let sources: ChatSource[] = []

  if (shouldRunWebSearch(params)) {
    const query = buildSearchQuery(params)
    callbacks.onSearchStart?.({ query })
    try {
      sources = await webSearch(query, { maxResults: config.webSearchMaxResults, signal })
      callbacks.onSources?.(sources)
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('[AIChat] Web search failed, continuing without sources:', error)
    }
  }

  await chatCompletionsStream({
    model: params.model,
    messages: buildMessages(params, sources)
  }, callbacks.onToken, signal)

  const metadata = { sources }
  callbacks.onDone?.(metadata)
  return metadata
}
