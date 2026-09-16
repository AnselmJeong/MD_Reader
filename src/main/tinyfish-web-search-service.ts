import type { ChatSource } from './ai-chat-types'

const SEARCH_URL = 'https://api.search.tinyfish.ai'
const FETCH_URL = 'https://api.fetch.tinyfish.ai'
type Options = { signal?: AbortSignal; maxResults?: number; fetchImpl?: typeof fetch; timeoutMs?: number }
const compact = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
function httpUrl(value: unknown): string | null {
  try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) ? url.href : null } catch { return null }
}
function requestSignal(signal: AbortSignal | undefined, ms: number) {
  return AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])])
}
async function payload(response: Response): Promise<{ results: unknown[] }> {
  if (!response.ok) throw new Error(`TinyFish request failed (HTTP ${response.status}).`)
  const data = await response.json()
  if (!data || !Array.isArray(data.results)) throw new Error('TinyFish returned an invalid response.')
  return data
}
export async function searchTinyFishWeb(query: string, apiKey: string, options: Options = {}): Promise<ChatSource[]> {
  if (!apiKey.trim()) throw new Error('Set a TinyFish API key in Settings to use web search.')
  const url = `${SEARCH_URL}?${new URLSearchParams({ query: query.replace(/\s+/g, ' ').trim().slice(0, 500), language: 'en' })}`
  const data = await payload(await (options.fetchImpl || fetch)(url, {
    headers: { Accept: 'application/json', 'X-API-Key': apiKey.trim() },
    signal: requestSignal(options.signal, options.timeoutMs ?? 8000)
  }))
  const sources: ChatSource[] = []
  const seen = new Set<string>()
  for (const candidate of data.results) {
    if (!candidate || typeof candidate !== 'object') continue
    const result = candidate as Record<string, unknown>
    const url = httpUrl(result.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    sources.push({ id: `S${sources.length + 1}`, url, hostname,
      title: compact(result.title, 180) || hostname, snippet: compact(result.snippet, 1600) || undefined })
    if (sources.length >= Math.min(10, Math.max(1, options.maxResults ?? 5))) break
  }
  return sources
}
export async function fetchTinyFishPages(urls: string[], apiKey: string, options: Options = {}): Promise<Array<{ url: string; title: string; content: string }>> {
  const safe = [...new Set(urls.map(httpUrl).filter((url): url is string => Boolean(url)))].slice(0, 3)
  if (!safe.length) return []
  const data = await payload(await (options.fetchImpl || fetch)(FETCH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey.trim() },
    body: JSON.stringify({ urls: safe, format: 'markdown', per_url_timeout_ms: 3000 }),
    signal: requestSignal(options.signal, options.timeoutMs ?? 4000)
  }))
  return data.results.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const result = candidate as Record<string, unknown>
    const url = httpUrl(result.url)
    if (!url || !safe.includes(url) || typeof result.text !== 'string' || !result.text.trim()) return []
    return [{ url, title: compact(result.title, 180), content: result.text.slice(0, 100000) }]
  })
}
