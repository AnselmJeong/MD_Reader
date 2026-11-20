// Finds pictures for coach cards without Electron APIs, so it can be tested with
// an injected fetch. Wikipedia comes first: TinyFish finds the right article
// (restricted to wikipedia.org) and the picture comes from Wikipedia's public
// page summary API. Brave Image Search is the fallback and fills the picker.
// Only the card's search phrase leaves the device: never book text or user data.
// No runtime imports here: the module runs directly under `node --test`.
import type { ChatSource } from './ai-chat-types'

export const WIKIPEDIA_USER_AGENT = 'MD-Reader/0.9 (reading coach; https://github.com/AnselmJeong/MD_Reader)'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface CoachImageLookup {
  bytes: Uint8Array
  contentType: string
  pageTitle: string
  pageUrl: string
  /** Caption source, e.g. "Wikipedia" or "Brave · britannica.com". */
  source: string
}

type Options = { fetchImpl?: typeof fetch; signal?: AbortSignal }
/** Web search restricted to wikipedia.org (TinyFish `include_domains`). */
export type WikipediaSearch = (query: string, signal?: AbortSignal) => Promise<ChatSource[]>


function timeout(signal: AbortSignal | undefined, ms: number) {
  return AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])])
}

export async function findWikipediaImage(card: { title: string; imageQuery: string }, search: WikipediaSearch, options: Options = {}): Promise<CoachImageLookup | null> {
  const doFetch = options.fetchImpl || fetch
  const query = card.imageQuery.trim()
  if (!query) return null
  const results = await search(query, options.signal)
  const seen = new Set<string>()
  const articles = results.map(result => wikipediaArticle(result.url))
    .filter((article): article is { lang: string; title: string } => Boolean(article && wikipediaTitleMatches(article.title, card)))
    .filter(article => { const key = `${article.lang}:${article.title}`; if (seen.has(key)) return false; seen.add(key); return true })
    .slice(0, 3)
  for (const article of articles) {
    const found = await wikipediaArticleImage(article, card, doFetch, options.signal).catch(() => null)
    if (found) return found
  }
  return null
}

/** Accept pictures only from Wikimedia's own media hosts (the summary API now serves thumb.wikimedia.org). */
export function isWikimediaImageUrl(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org')
}

async function wikipediaArticleImage(article: { lang: string; title: string }, card: { title: string; imageQuery: string }, doFetch: typeof fetch, signal?: AbortSignal): Promise<CoachImageLookup | null> {
  const options = { signal }
  const summaryUrl = `https://${article.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article.title.replace(/ /g, '_'))}`
  const response = await doFetch(summaryUrl, {
    headers: { Accept: 'application/json', 'User-Agent': WIKIPEDIA_USER_AGENT },
    signal: timeout(options.signal, 6000)
  })
  if (!response.ok) return null
  const summary = await response.json() as Record<string, unknown>
  if (summary.type === 'disambiguation') return null
  const thumbnail = summary.thumbnail as { source?: unknown } | undefined
  const source = typeof thumbnail?.source === 'string' ? thumbnail.source : ''
  let imageUrl: URL
  try { imageUrl = new URL(source) } catch { return null }
  if (!isWikimediaImageUrl(imageUrl)) return null
  const pageTitle = typeof summary.title === 'string' ? summary.title : article.title.replace(/_/g, ' ')
  if (!wikipediaTitleMatches(pageTitle, card)) return null
  const desktop = (summary.content_urls as { desktop?: { page?: unknown } } | undefined)?.desktop?.page
  const pageUrl = typeof desktop === 'string' && wikipediaArticle(desktop) ? desktop
    : `https://${article.lang}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`

  const image = await fetchImageBytes(imageUrl.href, doFetch, signal)
  return image ? { ...image, pageTitle, pageUrl, source: 'Wikipedia' } : null
}

/** Download a picture (https only, size-limited, raster types only). */
export async function fetchImageBytes(url: string, doFetch: typeof fetch = fetch, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  // Wikimedia serves WebP whenever the Accept header mentions it, and Electron cannot decode WebP.
  const image = await doFetch(parsed.href, { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT, Accept: 'image/png,image/jpeg,image/gif' }, signal: timeout(signal, 10000) })
  const contentType = (image.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!image.ok || !/^image\/(png|jpeg|gif|webp)$/.test(contentType)) return null
  const declared = Number(image.headers.get('content-length') || 0)
  if (declared > MAX_IMAGE_BYTES) return null
  const bytes = new Uint8Array(await image.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
  return { bytes, contentType }
}

// ─── Brave Image Search ───

const BRAVE_IMAGE_SEARCH_URL = 'https://api.search.brave.com/res/v1/images/search'

export interface BraveImageResult {
  title: string
  /** Brave's proxied thumbnail (imgs.search.brave.com): what we download. */
  thumbnailUrl: string
  imageUrl: string
  pageUrl: string
  source: string
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null } catch { return null }
}

export async function searchBraveImages(query: string, apiKey: string, options: Options & { count?: number } = {}): Promise<BraveImageResult[]> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!q || !apiKey.trim()) return []
  const url = new URL(BRAVE_IMAGE_SEARCH_URL)
  url.searchParams.set('q', q)
  url.searchParams.set('country', 'ALL')
  url.searchParams.set('search_lang', /[가-힣]/u.test(q) ? 'ko' : 'en')
  url.searchParams.set('count', '12')
  url.searchParams.set('safesearch', 'strict')
  url.searchParams.set('spellcheck', 'true')
  const response = await (options.fetchImpl || fetch)(url.href, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey.trim() },
    signal: timeout(options.signal, 10000)
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new Error(`Brave 이미지 검색 실패 (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  }
  const payload = await response.json() as { results?: Array<Record<string, any>> }
  const rank = (value: Record<string, any>) => value?.confidence === 'high' ? 2 : value?.confidence === 'medium' ? 1 : 0
  const ordered = [...(Array.isArray(payload?.results) ? payload.results : [])].sort((a, b) => rank(b) - rank(a))
  const seen = new Set<string>()
  const results: BraveImageResult[] = []
  for (const item of ordered) {
    const thumbnailUrl = httpsUrl(item?.thumbnail?.src)
    const imageUrl = httpsUrl(item?.properties?.url)
    const pageUrl = httpsUrl(item?.url)
    if (!thumbnailUrl || !thumbnailUrl.startsWith('https:') || !imageUrl || !pageUrl || seen.has(imageUrl)) continue
    seen.add(imageUrl)
    const host = new URL(pageUrl).hostname.replace(/^www\./, '')
    const source = (typeof item.source === 'string' && item.source.trim()) || item?.meta_url?.hostname || host
    const title = typeof item.title === 'string' ? item.title.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    results.push({ title: title || q, thumbnailUrl, imageUrl, pageUrl, source: String(source).replace(/^www\./, '').slice(0, 80) })
    if (results.length >= Math.min(12, Math.max(1, options.count ?? 6))) break
  }
  return results
}

// ─── Wikipedia matching ───

export function wikipediaArticle(url: string): { lang: string; title: string } | null {
  try {
    const parsed = new URL(url)
    const host = /^([a-z][a-z-]{1,15})(?:\.m)?\.wikipedia\.org$/.exec(parsed.hostname)
    const path = /^\/wiki\/([^?#]+)$/.exec(parsed.pathname)
    if (parsed.protocol !== 'https:' || !host || !path) return null
    const title = decodeURIComponent(path[1])
    if (/^(Special|File|Category|Help|Wikipedia|Talk|Portal|Template)[:_]/i.test(title)) return null
    if (/^[a-z]{1,8}:/i.test(title)) return null // interwiki links such as d:Q123
    return { lang: host[1], title }
  } catch { return null }
}

const significant = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/[()[\],.:;!?'"]/g, ' ').split(/[\s_-]+/).filter(word => word.length >= 3 && !['the', 'and', 'for', 'from', 'with', 'von', 'des', 'der'].includes(word))

/** Reject a picture when the article title does not overlap with the card. A wrong picture is worse than none. */
export function wikipediaTitleMatches(articleTitle: string, card: { title: string; imageQuery: string }): boolean {
  const article = significant(articleTitle.replace(/_/g, ' '))
  if (!article.length) return false
  const wanted = new Set([...significant(card.imageQuery), ...significant(card.title)])
  const overlap = article.filter(word => wanted.has(word)).length
  // When the card title names its subject in Latin script (e.g. "크립토필리아 미누투스(Cryptophialus minutus)"),
  // the article must be about that subject, not about someone the search phrase merely mentions ("Charles Darwin").
  const subject = significant(card.title).filter(word => /^[a-z0-9]+$/.test(word))
  if (subject.length && !article.some(word => subject.includes(word))) return false
  return overlap >= Math.min(2, article.length) || (overlap >= 1 && article.length <= 2)
}
