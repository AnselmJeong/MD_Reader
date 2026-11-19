// Finds a Wikipedia picture for a coach card without Electron APIs, so it can be
// tested with an injected fetch. TinyFish search has no image results, so it is
// used only to find the right Wikipedia article (restricted to wikipedia.org);
// the picture and its page link come from Wikipedia's public page summary API.
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
  const article = results.map(result => wikipediaArticle(result.url)).find(Boolean)
  if (!article || !wikipediaTitleMatches(article.title, card)) return null

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
  // Accept pictures only from Wikimedia's own media host.
  if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'upload.wikimedia.org') return null
  const pageTitle = typeof summary.title === 'string' ? summary.title : article.title.replace(/_/g, ' ')
  if (!wikipediaTitleMatches(pageTitle, card)) return null
  const desktop = (summary.content_urls as { desktop?: { page?: unknown } } | undefined)?.desktop?.page
  const pageUrl = typeof desktop === 'string' && wikipediaArticle(desktop) ? desktop
    : `https://${article.lang}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`

  const image = await doFetch(imageUrl.href, { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT }, signal: timeout(options.signal, 10000) })
  const contentType = image.headers.get('content-type') || ''
  if (!image.ok || !/^image\/(png|jpeg|gif|webp)/.test(contentType)) return null
  const declared = Number(image.headers.get('content-length') || 0)
  if (declared > MAX_IMAGE_BYTES) return null
  const bytes = new Uint8Array(await image.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
  return { bytes, contentType, pageTitle, pageUrl }
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
  return overlap >= Math.min(2, article.length) || (overlap >= 1 && article.length <= 2)
}
