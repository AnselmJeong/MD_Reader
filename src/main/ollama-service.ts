import { chatCompletionsStream, chatCompletionsText, listOpenAiModels } from './ollama-openai-client'

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
    const models = await listOpenAiModels()
    return models.map((model) => ({
      name: model.id,
      size: 0,
      modified_at: model.created ? new Date(model.created * 1000).toISOString() : ''
    }))
  } catch (error) {
    console.error('[Ollama] Failed to list models:', error)
    return []
  }
}

export async function chatStream(
  params: ChatParams,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const messages = params.systemPrompt
    ? [{ role: 'system', content: params.systemPrompt }, ...params.messages]
    : params.messages

  await chatCompletionsStream({
    model: params.model,
    messages
  }, onToken, signal)
}

export async function generateChatTitle(params: {
  model: string
  contextTitle: string
  messages: Array<{ role: string; content: string }>
}): Promise<string> {
  const transcript = params.messages
    .slice(0, 6)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, 700)}`)
    .join('\n\n')

  const raw = await chatCompletionsText({
    model: params.model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: 'Create a concise chat session title. Return only the title, with no quotes, no punctuation wrapper, and no explanation.'
      },
      {
        role: 'user',
        content: `Reading context: ${params.contextTitle}\n\nConversation:\n${transcript}\n\nTitle:`
      }
    ]
  })

  return raw
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

export async function generateJsonResponse(params: {
  model: string
  systemPrompt: string
  userPrompt: string
}): Promise<string> {
  return chatCompletionsText({
    model: params.model,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt }
    ]
  })
}
