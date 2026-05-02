const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'

interface OllamaModel {
  name: string
  size: number
  modified_at: string
}

interface ChatParams {
  model: string
  messages: Array<{ role: string; content: string }>
  systemPrompt?: string
}

export async function listModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`)
    if (!response.ok) throw new Error(`Ollama API error: ${response.status}`)
    const data = await response.json()
    return data.models || []
  } catch (error) {
    console.error('[Ollama] Failed to list models:', error)
    return []
  }
}

export async function chatStream(
  params: ChatParams,
  onToken: (token: string) => void
): Promise<void> {
  const messages = [...params.messages]

  if (params.systemPrompt) {
    messages.unshift({ role: 'system', content: params.systemPrompt })
  }

  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      messages,
      stream: true
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.message?.content) {
          onToken(parsed.message.content)
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer)
      if (parsed.message?.content) {
        onToken(parsed.message.content)
      }
    } catch {
      // skip
    }
  }
}
