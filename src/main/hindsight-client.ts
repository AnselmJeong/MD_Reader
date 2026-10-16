import { createHash } from 'node:crypto'
import type { AgentMemorySettings } from './agent-memory-settings'

export interface HindsightMemoryResult {
  id: string
  memory: string
  metadata?: Record<string, string>
}

type ApiMode = 'direct' | 'control-plane'
const routes = new Map<string, { mode: ApiMode; expires: number }>()

function serverUrl(settings: AgentMemorySettings): string {
  const url = new URL(settings.hindsightBaseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Hindsight server URL')
  return url.toString().replace(/\/+$/, '')
}

class HindsightHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function jsonRequest(settings: AgentMemorySettings, path: string, method = 'GET', body?: unknown, signal?: AbortSignal, timeout = 8000): Promise<any> {
  const response = await fetch(serverUrl(settings) + path, {
    method,
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(settings.hindsightApiKey ? { Authorization: `Bearer ${settings.hindsightApiKey}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) throw new HindsightHttpError(`Hindsight ${method} failed: HTTP ${response.status} ${response.statusText}. 서버 주소와 뱅크 ID를 확인하세요.`, response.status)
  if (!contentType.includes('application/json')) throw new Error('Hindsight API의 JSON 응답을 받지 못했습니다. 서버 주소 또는 로그인 상태를 확인하세요.')
  return response.json()
}

async function apiMode(settings: AgentMemorySettings, signal?: AbortSignal): Promise<ApiMode> {
  const key = serverUrl(settings) + ':' + createHash('sha256').update(settings.hindsightApiKey).digest('hex')
  const cached = routes.get(key)
  if (cached && cached.expires > Date.now()) return cached.mode
  // Probe only read-only endpoints on the configured origin. Never fall back to localhost.
  for (const mode of ['direct', 'control-plane'] as const) {
    try {
      const data = await jsonRequest(settings, mode === 'direct' ? '/v1/default/banks?limit=1' : '/api/banks?limit=1', 'GET', undefined, signal)
      if (!Array.isArray(data.banks)) throw new Error('Invalid Hindsight bank list')
      routes.set(key, { mode, expires: Date.now() + 60000 })
      return mode
    } catch (error) {
      if (!(error instanceof HindsightHttpError) || ![404, 405].includes(error.status) || mode === 'control-plane') throw error
    }
  }
  throw new Error('Hindsight API 경로를 찾지 못했습니다. 서버 주소는 /dashboard 없이 입력하세요.')
}

async function request(settings: AgentMemorySettings, suffix: string, method = 'GET', body?: Record<string, unknown>, signal?: AbortSignal, timeout = 8000): Promise<any> {
  const mode = await apiMode(settings, signal)
  const bank = encodeURIComponent(settings.hindsightBankId)
  if (mode === 'direct') return jsonRequest(settings, `/v1/default/banks/${bank}${suffix}`, method, body, signal, timeout)
  if (suffix === '/stats') return jsonRequest(settings, `/api/stats/${bank}`, 'GET', undefined, signal, timeout)
  if (!suffix && method === 'PUT') return jsonRequest(settings, '/api/banks', 'POST', { bank_id: settings.hindsightBankId }, signal, timeout)
  const path = suffix === '/memories/recall' ? '/api/recall' : suffix === '/memories' ? '/api/memories/retain' : null
  if (!path) throw new Error('Unsupported Hindsight control-plane operation')
  return jsonRequest(settings, path, method, { ...body, bank_id: settings.hindsightBankId }, signal, timeout)
}

export async function ensureHindsightBank(settings: AgentMemorySettings): Promise<void> {
  try {
    // Connecting to an existing bank never updates its configuration.
    await readBankStats(settings)
    return
  } catch (error) {
    if (!(error instanceof HindsightHttpError) || error.status !== 404) throw error
  }
  const created = await request(settings, '', 'PUT', {})
  if (created.bank_id !== settings.hindsightBankId) throw new Error('Hindsight API returned a different bank ID')
  await readBankStats(settings)
}

export function hindsightDocumentId(content: string, metadata: Record<string, unknown>): string {
  return 'md-reader-' + createHash('sha256').update(JSON.stringify([metadata.session_id ?? '', content.trim()])).digest('hex')
}

export async function retainHindsightMemory(settings: AgentMemorySettings, params: {
  content: string
  metadata: Record<string, unknown>
}): Promise<{ memoryId: string; eventId?: string }> {
  const documentId = hindsightDocumentId(params.content, params.metadata)
  const metadata = Object.fromEntries(Object.entries(params.metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
  const result = await request(settings, '/memories', 'POST', {
    async: false,
    items: [{ content: params.content, document_id: documentId, metadata,
      context: 'Curated reading insight from an MD Reader conversation; preserve uncertainty and provenance.',
      tags: ['md-reader'], ...(metadata.created_at ? { timestamp: metadata.created_at } : {}) }]
  }, undefined, 120000)
  if (result.success !== true || result.async !== false || result.items_count !== 1) throw new Error('Hindsight did not confirm completed retention')
  return { memoryId: documentId }
}

export async function recallHindsight(settings: AgentMemorySettings, query: string, limit = 5, signal?: AbortSignal): Promise<HindsightMemoryResult[]> {
  const data = await request(settings, '/memories/recall', 'POST', { query, budget: 'low', max_tokens: 1200 }, signal, 20000)
  if (!Array.isArray(data.results)) throw new Error('Invalid Hindsight recall response')
  return data.results.filter((item: any) => typeof item.text === 'string' && item.text.trim())
    .slice(0, limit).map((item: any) => ({ id: item.id, memory: item.text, metadata: item.metadata }))
}

async function readBankStats(settings: AgentMemorySettings, signal?: AbortSignal): Promise<void> {
  const stats = await request(settings, '/stats', 'GET', undefined, signal)
  if (stats.bank_id !== settings.hindsightBankId || typeof stats.total_nodes !== 'number') {
    throw new Error('Hindsight API의 뱅크 정보를 확인할 수 없습니다. API 서버 주소를 확인하세요.')
  }
}

export async function checkHindsightHealth(settings: AgentMemorySettings, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  try {
    // Bank stats checks connectivity, auth and the chosen bank without an LLM recall.
    await readBankStats(settings, signal)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Hindsight is unavailable' }
  }
}
