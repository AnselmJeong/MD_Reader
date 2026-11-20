import type { CoachCard, CoachCardKind, CoachDeck } from './coach'

// Same as COACH_USER_PART; repeated so this file has no runtime imports (node tests load it directly).
const USER_PART = 999

/** Same as sanitizeCardPosition / sameCardPlace in coach.ts, repeated for the same reason. */
function sanitizeCardPosition(value: unknown): CoachCard['at'] {
  const entry = value as Record<string, unknown> | null
  if (!entry || typeof entry !== 'object') return undefined
  const href = typeof entry.href === 'string' ? entry.href.split('#')[0] : ''
  const occurrence = Number(entry.occurrence)
  if (!href || href.length > 4096 || !Number.isSafeInteger(occurrence) || occurrence < 0 || occurrence > 100000) return undefined
  return { href, occurrence }
}
function sameCardPlace(a: CoachCard, b: CoachCard): boolean {
  if (a.quote !== b.quote) return false
  if (!a.at || !b.at) return !a.at && !b.at
  return a.at.href === b.at.href && a.at.occurrence === b.at.occurrence
}

/**
 * Coach cards travel inside an exported EPUB as `MDReader-Commentary/coach.json`
 * plus their pictures. Another MD Reader merges them on open; other readers ignore the files.
 */
export const COACH_ARCHIVE_FORMAT = 'md-reader-coach'
export const COACH_ARCHIVE_VERSION = 1
export const MAX_ARCHIVE_DECKS = 2000
export const MAX_ARCHIVE_IMAGES = 3000
export const MAX_ARCHIVE_IMAGE_BYTES = 4 * 1024 * 1024

export interface CoachArchiveImage {
  /** coach_images query key, e.g. "v3:karl jaspers". */
  key: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  pageTitle: string | null
  pageUrl: string | null
  source: string | null
}

export interface CoachArchiveImageData extends CoachArchiveImage { bytes: Uint8Array }

export interface CoachArchive {
  bookTitle: string
  decks: CoachDeck[]
  images: CoachArchiveImageData[]
}

export const IMAGE_EXTENSIONS: Record<CoachArchiveImage['mime'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

const KINDS: CoachCardKind[] = ['term', 'person', 'place', 'background', 'math', 'structure', 'critique', 'connection']
const str = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const strings = (value: unknown, limit: number, count: number) => Array.isArray(value) ? value.map(item => str(item, limit)).filter(Boolean).slice(0, count) : []

export function sanitizeArchiveCard(value: unknown): CoachCard | null {
  const entry = value as Record<string, unknown> | null
  if (!entry || typeof entry !== 'object') return null
  const id = str(entry.id, 64)
  const kind = KINDS.includes(entry.kind as CoachCardKind) ? entry.kind as CoachCardKind : null
  const quote = str(entry.quote, 1200)
  const title = str(entry.title, 120)
  const gloss = str(entry.gloss, 1500)
  if (!/^[a-f0-9]{8,64}$/.test(id) || !kind || quote.length < 2 || !title || !gloss) return null
  const imageQuery = str(entry.imageQuery, 160)
  const difficulty = Math.min(5, Math.max(1, Math.round(Number(entry.difficulty) || 3)))
  const at = sanitizeCardPosition(entry.at)
  return { id, kind, difficulty, quote, title, gloss, ...(imageQuery ? { imageQuery } : {}), ...(at ? { at } : {}) }
}

/** Untrusted deck from a file: keep only well-formed fields, and bind it to this book. */
export function sanitizeArchiveDeck(value: unknown, documentId: string): CoachDeck | null {
  const entry = value as Record<string, unknown> | null
  if (!entry || typeof entry !== 'object') return null
  const key = str(entry.key, 64)
  const chapterHref = typeof entry.chapterHref === 'string' ? entry.chapterHref.split('#')[0] : ''
  const part = Number(entry.part)
  if (!/^[a-f0-9]{64}$/.test(key) || !chapterHref || chapterHref.length > 4096 || !Number.isSafeInteger(part)
    || !((part >= 0 && part <= 100) || part === USER_PART)) return null
  const cards: CoachCard[] = []
  for (const item of Array.isArray(entry.cards) ? entry.cards : []) {
    const card = sanitizeArchiveCard(item)
    if (card && !cards.some(other => other.id === card.id)) cards.push(card)
    if (cards.length >= 100) break
  }
  const sections = (Array.isArray(entry.sections) ? entry.sections : []).flatMap((item) => {
    const section = item as Record<string, unknown> | null
    const summary = str(section?.summary, 800)
    return summary ? [{ quote: str(section?.quote, 300), summary }] : []
  }).slice(0, 30)
  const brief = str(entry.brief, 1200)
  if (!cards.length && !brief) return null
  const createdAt = Number(entry.createdAt)
  return {
    key, documentId, chapterHref, part,
    domain: strings(entry.domain, 60, 4).map(item => item.toLowerCase()),
    brief, sections,
    recap: strings(entry.recap, 400, 6),
    questions: strings(entry.questions, 400, 5),
    cards,
    dropped: Math.max(0, Math.min(1000, Math.round(Number(entry.dropped) || 0))),
    model: str(entry.model, 120) || 'imported',
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.min(createdAt, Date.now()) : Date.now()
  }
}

export function sanitizeArchiveImage(value: unknown): CoachArchiveImage | null {
  const entry = value as Record<string, unknown> | null
  if (!entry || typeof entry !== 'object') return null
  const key = typeof entry.key === 'string' ? entry.key : ''
  const mime = entry.mime as CoachArchiveImage['mime']
  if (!key || key.length > 220 || !IMAGE_EXTENSIONS[mime]) return null
  let pageUrl: string | null = null
  try { const url = new URL(String(entry.pageUrl)); if (/^https?:$/.test(url.protocol)) pageUrl = url.href } catch { /* keep null */ }
  return { key, mime, pageTitle: str(entry.pageTitle, 200) || null, pageUrl, source: str(entry.source, 100) || null }
}

/** "My cards" from two machines: keep local cards, add the ones only the file has. */
export function mergeUserDeck(local: CoachDeck | null, incoming: CoachDeck): CoachDeck {
  if (!local) return incoming
  const ids = new Set(local.cards.map(card => card.id))
  const added = incoming.cards.filter(card => !ids.has(card.id) && !local.cards.some(item => sameCardPlace(item, card)))
  return added.length ? { ...local, cards: [...local.cards, ...added].slice(-100) } : local
}

/** The newest deck for each chapter part; older prompt versions and request texts are left out. */
export function latestDecks(decks: CoachDeck[]): CoachDeck[] {
  const best = new Map<string, CoachDeck>()
  for (const deck of decks) {
    const id = `${deck.chapterHref.split('#')[0]}|${deck.part}`
    const current = best.get(id)
    if (!current || deck.createdAt > current.createdAt) best.set(id, deck)
  }
  return [...best.values()].sort((a, b) => a.chapterHref.localeCompare(b.chapterHref) || a.part - b.part)
}

/** Regex that finds a card's quote in book text despite whitespace, quote and dash variants. */
export function quotePattern(quote: string): RegExp | null {
  const words = quote.replace(/­/g, '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || quote.length < 2) return null
  const char = (c: string) => {
    if (/['‘’‚′]/.test(c)) return "['‘’‚′]"
    if (/["“”„″]/.test(c)) return '["“”„″]'
    if (/[-–—]/.test(c)) return '[-–—]'
    return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(words.map(word => [...word].map(char).join('­?')).join('\\s+'))
}
