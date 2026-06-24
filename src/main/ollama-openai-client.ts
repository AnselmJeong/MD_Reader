import { getAiProviderConfig } from './ai-provider-settings'
import type { ChatMessageInput } from './ai-chat-types'

export interface OpenAiModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

export interface OpenAiChatStreamParams {
  model: string
  messages: ChatMessageInput[]
  temperature?: number
  responseFormat?: { type: 'json_object' }
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

function getAuthHeaders(): HeadersInit {
  const config = getAiProviderConfig()
  if (!config.ollamaApiKey) {
    throw new AiProviderError('Ollama Cloud API key is required. Add it in Settings > AI Settings.')
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.ollamaApiKey}`
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return `${response.status} ${response.statusText}`
    try {
      const parsed = JSON.parse(text)
      return parsed.error?.message || parsed.error || text
    } catch {
      return text
    }
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

function getEndpoint(path: string): string {
  const config = getAiProviderConfig()
  return `${config.ollamaBaseUrl}${path}`
}

export async function listOpenAiModels(): Promise<OpenAiModel[]> {
  const response = await fetch(getEndpoint('/models'), {
    method: 'GET',
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    throw new AiProviderError(`Ollama models request failed: ${await readError(response)}`, response.status)
  }

  const data = await response.json() as { data?: OpenAiModel[]; models?: Array<{ name?: string; model?: string }> }
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.models)) {
    return data.models
      .map((model) => ({ id: String(model.name || model.model || '').trim() }))
      .filter((model) => model.id)
  }
  return []
}

export async function chatCompletionsStream(
  params: OpenAiChatStreamParams,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(getEndpoint('/chat/completions'), {
    method: 'POST',
    headers: getAuthHeaders(),
    signal,
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.responseFormat ? { response_format: params.responseFormat } : {})
    })
  })

  if (!response.ok) {
    throw new AiProviderError(`Ollama chat request failed: ${await readError(response)}`, response.status)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new AiProviderError('Ollama chat response had no body')

  const decoder = new TextDecoder()
  let buffer = ''

  const consumeEvent = (event: string) => {
    const dataLines = event
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())

    for (const data of dataLines) {
      if (!data || data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
        if (token) onToken(String(token))
      } catch {
        // Ignore malformed provider frames while preserving the stream.
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\n\n+/)
    buffer = events.pop() || ''
    for (const event of events) consumeEvent(event)
  }

  buffer += decoder.decode()
  if (buffer.trim()) consumeEvent(buffer)
}

export async function chatCompletionsText(
  params: OpenAiChatStreamParams,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(getEndpoint('/chat/completions'), {
    method: 'POST',
    headers: getAuthHeaders(),
    signal,
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: false,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.responseFormat ? { response_format: params.responseFormat } : {})
    })
  })

  if (!response.ok) {
    throw new AiProviderError(`Ollama chat request failed: ${await readError(response)}`, response.status)
  }

  const data = await response.json()
  return String(data.choices?.[0]?.message?.content ?? '').trim()
}
