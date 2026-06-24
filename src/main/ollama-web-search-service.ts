import { getAiProviderConfig } from './ai-provider-settings'
import { AiProviderError } from './ollama-openai-client'
import type { ChatSource } from './ai-chat-types'

interface SearchResult {
  title?: string
  url?: string
  content?: string
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized
}

function getHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function normalizeSource(result: SearchResult, index: number): ChatSource | null {
  const url = result.url?.trim()
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null

  const hostname = getHostname(url)
  return {
    id: `S${index + 1}`,
    title: truncate(result.title, 120) || hostname || url,
    url,
    hostname,
    snippet: truncate(result.content, 500)
  }
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const config = getAiProviderConfig()
  if (!config.ollamaApiKey) {
    throw new AiProviderError('Ollama Cloud API key is required for web search.')
  }

  const response = await fetch(`${config.ollamaSearchBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ollamaApiKey}`
    },
    signal,
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new AiProviderError(`Ollama web request failed: ${response.status} ${response.statusText}`, response.status)
  }

  return response.json() as Promise<T>
}

export async function webSearch(
  query: string,
  options?: { maxResults?: number; signal?: AbortSignal }
): Promise<ChatSource[]> {
  const maxResults = Math.min(Math.max(options?.maxResults ?? 5, 1), 10)
  const data = await postJson<{ results?: SearchResult[] }>('/web_search', {
    query,
    max_results: maxResults
  }, options?.signal)

  return (data.results || [])
    .map((result, index) => normalizeSource(result, index))
    .filter((source): source is ChatSource => Boolean(source))
}

export async function webFetch(url: string, signal?: AbortSignal): Promise<ChatSource | null> {
  const data = await postJson<{ title?: string; content?: string; links?: string[] }>('/web_fetch', { url }, signal)
  return normalizeSource({ title: data.title, url, content: data.content }, 0)
}
