import type { AgentMemorySettings } from './agent-memory-settings'

export interface Mem0MemoryResult {
  id?: string
  memory?: string
  score?: number
  metadata?: Record<string, unknown>
}

function buildHeaders(settings: AgentMemorySettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.mem0AuthMode === 'x-api-key' && settings.mem0ApiKey) {
    headers['X-API-Key'] = settings.mem0ApiKey
  } else if (settings.mem0AuthMode === 'bearer' && settings.mem0ApiKey) {
    headers.Authorization = `Bearer ${settings.mem0ApiKey}`
  }
  return headers
}

function baseUrl(settings: AgentMemorySettings): string {
  return settings.mem0BaseUrl.replace(/\/+$/, '')
}

async function responseError(prefix: string, response: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await response.text()
    if (body.trim()) detail = `: ${body.slice(0, 300)}`
  } catch {
    // Ignore body parse failures and keep the status-based error.
  }
  return new Error(`${prefix}: ${response.status} ${response.statusText}${detail}`)
}

export async function addMem0Memory(settings: AgentMemorySettings, params: {
  content: string
  metadata: Record<string, unknown>
}): Promise<{ memoryId?: string; eventId?: string }> {
  const response = await fetch(`${baseUrl(settings)}/memories`, {
    method: 'POST',
    headers: buildHeaders(settings),
    body: JSON.stringify({
      messages: [{ role: 'user', content: params.content }],
      user_id: settings.userId,
      metadata: params.metadata,
      infer: false
    })
  })

  if (!response.ok) {
    throw await responseError('mem0 add failed', response)
  }

  const data = await response.json()
  if (Array.isArray(data)) {
    const first = data[0]
    return {
      eventId: first?.id,
      memoryId: first?.data?.memory?.id ?? first?.memory_id
    }
  }
  const firstResult = Array.isArray(data?.results) ? data.results[0] : null
  return {
    eventId: data?.id,
    memoryId: data?.data?.memory?.id ?? firstResult?.memory_id ?? firstResult?.id
  }
}

export async function searchMem0(settings: AgentMemorySettings, query: string, limit = 5): Promise<Mem0MemoryResult[]> {
  const response = await fetch(`${baseUrl(settings)}/search`, {
    method: 'POST',
    headers: buildHeaders(settings),
    body: JSON.stringify({
      query,
      user_id: settings.userId,
      limit
    })
  })

  if (!response.ok) {
    throw await responseError('mem0 search failed', response)
  }

  const data = await response.json()
  const results = Array.isArray(data) ? data : data?.results
  if (!Array.isArray(results)) return []
  return results.map((item) => ({
    id: item.id ?? item.memory_id,
    memory: item.memory ?? item.content ?? item.text,
    score: item.score,
    metadata: item.metadata
  })).filter((item) => typeof item.memory === 'string' && item.memory.trim())
}

export async function checkMem0Health(settings: AgentMemorySettings): Promise<{ ok: boolean; error?: string }> {
  if (!settings.mem0BaseUrl.trim()) return { ok: false, error: 'mem0 Base URL is not configured' }
  if (settings.mem0AuthMode !== 'none' && !settings.mem0ApiKey.trim()) {
    return { ok: false, error: 'mem0 API key is not configured' }
  }

  try {
    const response = await fetch(`${baseUrl(settings)}/search`, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify({
        query: 'md-reader startup health check',
        user_id: settings.userId,
        limit: 1
      })
    })
    if (response.ok) return { ok: true }
    const error = await responseError('mem0 health check failed', response)
    return { ok: false, error: error.message }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown mem0 error' }
  }
}
