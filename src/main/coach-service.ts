import { BrowserWindow, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { chatCompletionsText, getSubscriptionStatus } from './subscription-client'
import { codexClient } from './codex/client'
import { getAiProviderConfig } from './ai-provider-settings'
import { fetchImageBytes, findWikipediaImage, searchBraveImages, type CoachImageLookup } from './coach-image-service'
import { searchTinyFishWeb } from './tinyfish-web-search-service'
import {
  appendEvent, countUsage, insertReviews, readDeck, readDueReviews, readEncounters, readImage, readKv, readLastPreferences, readOpenedCardIds, readPreferences,
  readProfile, readReview, readSettings, readUsage, updateReview, writeDeck, writeImage, writeKv, writePreferences, writeProfile, writeSettings, writeTerms
} from './coach-store'
import { searchCommentaryNotes } from './commentary-service'
import { getAgentMemorySettings } from './agent-memory-settings'
import { COACH_PROFILE_SECTION, replaceUserSection } from './agent-memory-files'
import { checkHindsightHealth, recallHindsight, retainHindsightMemory } from './hindsight-client'
import {
  applyCoachEvent, buildCoachDeckPrompt, buildSelectionCardPrompt, COACH_USER_PART, coachImageKey, parseSelectionCard, type CoachCard, type CoachSelectionCardRequest, coachDeckCacheInput, coachHash, coachTermKey, EMPTY_COACH_PROFILE, nextReviewInterval, parseCoachDeck, sanitizePreferences,
  summarizeCoachProfile, type CoachChapterLinks, type CoachLinksRequest, type CoachMemoryLinks, type CoachPersonalLink, type CoachReviewItem, type CoachReviewRequest,
  type CoachDeck, type CoachDeckRequest, type CoachDeckUpdate, type CoachEvent, type CoachImage, type CoachImageCandidate, type CoachImageSearchResult, type CoachPreferences, type CoachProfile, type CoachSettings
} from '../shared/coach'
import { validateDocumentId } from './commentary-service'

const LANGUAGE = 'ko'
const MAX_CHAPTER_CHARS = 60000
const MAX_PENDING = 3

// ─── Preferences, settings, profile ───

export function getCoachPreferences(documentId: string) {
  validateDocumentId(documentId)
  return { preferences: readPreferences(documentId), lastPreferences: readLastPreferences(), settings: readSettings() }
}
export function setCoachPreferences(documentId: string, preferences: CoachPreferences) {
  validateDocumentId(documentId)
  return writePreferences(documentId, sanitizePreferences(preferences))
}
export const getCoachSettings = () => readSettings()
export const setCoachSettings = (partial: Partial<CoachSettings>) => writeSettings(partial ?? {})
export const getCoachUsage = () => readUsage()
export const getCoachProfile = () => readProfile()
export function resetCoachProfile(): CoachProfile { writeProfile(EMPTY_COACH_PROFILE); return EMPTY_COACH_PROFILE }

const EVENT_TYPES = new Set(['open', 'more', 'insert', 'known', 'notInterested', 'dismiss', 'miss'])
export function recordCoachEvent(event: CoachEvent): CoachProfile {
  validateDocumentId(event?.documentId)
  if (!EVENT_TYPES.has(event.type) || typeof event.chapterHref !== 'string' || !Array.isArray(event.domain)) throw new Error('코치 기록이 올바르지 않습니다.')
  const clean: CoachEvent = {
    documentId: event.documentId, chapterHref: event.chapterHref.slice(0, 4096), type: event.type,
    domain: event.domain.filter(item => typeof item === 'string').map(item => item.slice(0, 60)).slice(0, 4),
    ...(typeof event.cardId === 'string' ? { cardId: event.cardId.slice(0, 64) } : {}),
    ...(typeof event.kind === 'string' ? { kind: event.kind } : {}),
    ...(Number.isFinite(event.difficulty) ? { difficulty: Math.min(5, Math.max(1, Math.round(event.difficulty!))) } : {}),
    at: Date.now()
  }
  appendEvent(clean)
  const profile = applyCoachEvent(readProfile(), clean)
  writeProfile(profile)
  scheduleProfileSync()
  return profile
}

// ─── Model choice and budget ───

let chatBusy: () => boolean = () => false
/** The reader's own chat question always goes first. */
export function setCoachChatBusyProbe(probe: () => boolean) { chatBusy = probe }

export async function resolveCoachModel(chatModel: string, setting = readSettings().coachModel): Promise<string> {
  if (setting && setting !== 'auto') return setting
  if (chatModel.startsWith('claude:')) return 'claude:sonnet'
  try {
    const models = await codexClient.models()
    const sol = models.find(model => /gpt-?6\.2.*sol/i.test(model.id)) ?? models.find(model => /sol/i.test(model.id))
    if (sol) return `codex:${sol.id}`
  } catch { /* fall back to the account default */ }
  return 'codex:default'
}

function percent(value: number) { return value <= 1 ? value * 100 : value }
async function quotaBlock(model: string, pausePercent: number): Promise<string | null> {
  try {
    const status = await getSubscriptionStatus()
    let used = 0
    if (model.startsWith('claude:')) used = percent(status.claude.quota?.utilization ?? 0)
    else used = Math.max(0, ...status.codex.quotas.flatMap(quota => [quota.primary?.usedPercent ?? 0, quota.secondary?.usedPercent ?? 0]))
    return used >= pausePercent ? `구독 사용률이 ${Math.round(used)}%라서 백그라운드 준비를 멈췄습니다. 직접 하는 질문은 그대로 됩니다.` : null
  } catch { return null }
}

// ─── Deck queue: one job at a time, newest chapter first ───

interface Job { key: string; request: CoachDeckRequest; preferences: CoachPreferences }
const pending: Job[] = []
const inFlight = new Set<string>()
let running = false

function broadcast(update: CoachDeckUpdate) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('coach:deck', update)
}
const deckKey = (request: CoachDeckRequest, preferences: CoachPreferences) =>
  createHash('sha256').update(coachDeckCacheInput(request, LANGUAGE, preferences.request)).digest('hex')

function validateRequest(request: CoachDeckRequest) {
  validateDocumentId(request?.documentId)
  if (typeof request.chapterHref !== 'string' || !request.chapterHref || request.chapterHref.length > 4096
    || !Number.isSafeInteger(request.part) || request.part < 0 || request.part > 100
    || typeof request.chapterText !== 'string' || typeof request.chatModel !== 'string') throw new Error('코치 요청이 올바르지 않습니다.')
}

export function requestCoachDeck(request: CoachDeckRequest): CoachDeckUpdate {
  validateRequest(request)
  const base = { documentId: request.documentId, chapterHref: request.chapterHref, part: request.part }
  const preferences = readPreferences(request.documentId)
  if (!preferences?.enabled) return { ...base, status: 'idle' }
  const key = deckKey(request, preferences)
  if (!request.force) {
    const cached = readDeck(key)
    if (cached) { countUsage('cache_hits'); return { ...base, status: 'ready', deck: cached } }
  }
  if (inFlight.has(key)) return { ...base, status: 'generating' }
  if (pending.some(job => job.key === key)) return { ...base, status: 'queued' }
  if (request.peek) return { ...base, status: 'idle' }
  const settings = readSettings()
  if (readUsage().calls >= settings.dailyLimit) return { ...base, status: 'limited', error: `오늘 코치가 준비할 수 있는 장 수(${settings.dailyLimit}개)를 다 썼습니다. 설정에서 바꿀 수 있습니다.` }
  if (request.chapterText.trim().length < 200) return { ...base, status: 'error', error: '이 장은 코치 카드를 만들기에 본문이 너무 짧습니다.' }
  pending.unshift({ key, request: { ...request, chapterText: request.chapterText.slice(0, MAX_CHAPTER_CHARS) }, preferences })
  // Readers who page quickly should not leave a backlog of background calls.
  for (const dropped of pending.splice(MAX_PENDING)) broadcast({ documentId: dropped.request.documentId, chapterHref: dropped.request.chapterHref, part: dropped.request.part, status: 'idle' })
  void drain()
  return { ...base, status: 'queued' }
}

async function drain() {
  if (running) return
  running = true
  try {
    while (pending.length) {
      while (chatBusy()) await new Promise(resolve => setTimeout(resolve, 2000))
      const job = pending.shift()
      if (!job) break
      inFlight.add(job.key)
      try { await runJob(job) } finally { inFlight.delete(job.key) }
    }
  } finally { running = false }
}

async function runJob({ key, request, preferences }: Job) {
  const base = { documentId: request.documentId, chapterHref: request.chapterHref, part: request.part }
  const settings = readSettings()
  if (readUsage().calls >= settings.dailyLimit) {
    broadcast({ ...base, status: 'limited', error: `오늘 코치가 준비할 수 있는 장 수(${settings.dailyLimit}개)를 다 썼습니다.` })
    return
  }
  const model = await resolveCoachModel(request.chatModel, settings.coachModel)
  const blocked = await quotaBlock(model, settings.quotaPausePercent)
  if (blocked) { broadcast({ ...base, status: 'limited', error: blocked }); return }
  broadcast({ ...base, status: 'generating' })
  countUsage('calls')
  try {
    const prompt = buildCoachDeckPrompt({ bookTitle: request.bookTitle, chapterTitle: request.chapterTitle, chapterText: request.chapterText, request: preferences.request, part: request.part })
    const raw = await chatCompletionsText({ model, responseFormat: { type: 'json_object' }, messages: [
      { role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }
    ] })
    const parsed = parseCoachDeck(JSON.parse(raw), request.chapterText)
    if (!parsed.cards.length && !parsed.brief) throw new Error('본문과 맞는 카드를 만들지 못했습니다. "이 장 다시 준비"로 다시 시도해 보세요.')
    const deck: CoachDeck = { ...parsed, key, documentId: request.documentId, chapterHref: request.chapterHref.split('#')[0], part: request.part, model, createdAt: Date.now() }
    writeDeck(deck)
    // Remember terms so later books can reuse them without another model call.
    writeTerms(deck, request.bookTitle, request.chapterTitle)
    writeKv(`book:${request.documentId}`, request.bookTitle.slice(0, 300))
    broadcast({ ...base, status: 'ready', deck })
  } catch (error) {
    countUsage('failures')
    broadcast({ ...base, status: 'error', error: error instanceof Error ? error.message : '코치 카드를 만들지 못했습니다.' })
  }
}

// ─── Cards the reader asks for ───

const userDeckKey = (documentId: string, chapterHref: string) =>
  createHash('sha256').update(JSON.stringify(['user-cards', documentId, chapterHref.split('#')[0]])).digest('hex')

export function getCoachUserDeck(documentId: string, chapterHref: string): CoachDeck | null {
  validateDocumentId(documentId)
  if (typeof chapterHref !== 'string' || !chapterHref || chapterHref.length > 4096) return null
  return readDeck(userDeckKey(documentId, chapterHref))
}

/** The reader asked for this card, so it skips the daily limit and quota pause (it still counts as a call). */
export async function createCoachSelectionCard(request: CoachSelectionCardRequest): Promise<{ deck: CoachDeck; card: CoachCard }> {
  validateDocumentId(request?.documentId)
  if (typeof request.chapterHref !== 'string' || !request.chapterHref || request.chapterHref.length > 4096
    || typeof request.selectedText !== 'string' || typeof request.chatModel !== 'string') throw new Error('코치 요청이 올바르지 않습니다.')
  const selectedText = request.selectedText.replace(/\s+/g, ' ').trim()
  if (selectedText.length < 2) throw new Error('카드를 만들 글을 선택해 주세요.')
  if (selectedText.length > 1200) throw new Error('선택한 글이 너무 깁니다. 단어나 구절, 한두 문장 정도로 골라 주세요.')
  const chapterHref = request.chapterHref.split('#')[0]
  const model = await resolveCoachModel(request.chatModel)
  const prompt = buildSelectionCardPrompt({
    bookTitle: String(request.bookTitle ?? '').slice(0, 300), chapterTitle: String(request.chapterTitle ?? '').slice(0, 300),
    selectedText, paragraph: String(request.paragraph ?? '').replace(/\s+/g, ' ').trim().slice(0, 3000),
    request: readPreferences(request.documentId)?.request
  })
  countUsage('calls')
  let card: CoachCard
  try {
    const raw = await chatCompletionsText({ model, responseFormat: { type: 'json_object' }, messages: [
      { role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }
    ] })
    card = parseSelectionCard(JSON.parse(raw), selectedText)
  } catch (error) {
    countUsage('failures')
    throw error instanceof SyntaxError ? new Error('코치 응답을 읽지 못했습니다. 다시 시도해 보세요.') : error
  }
  const key = userDeckKey(request.documentId, chapterHref)
  const existing = readDeck(key)
  const deck: CoachDeck = existing
    ? { ...existing, cards: [...existing.cards.filter(item => item.id !== card.id && item.quote !== card.quote), card].slice(-100), model, createdAt: Date.now() }
    : { key, documentId: request.documentId, chapterHref, part: COACH_USER_PART, domain: [], brief: '', sections: [], recap: [], questions: [], cards: [card], dropped: 0, model, createdAt: Date.now() }
  writeDeck(deck)
  writeKv(`book:${request.documentId}`, String(request.bookTitle ?? '').slice(0, 300))
  return { deck, card }
}

// ─── Pictures ───

// Misses are retried after a day. Keys carry a version so misses cached by older
// bugs (thumb.wikimedia.org rejected; WebP/GIF pictures that could not be decoded) are ignored.
const NONE_TTL = 86400000
const IMAGE_KEY_VERSION = 'v3:'
const MAX_RAW_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_WIDTH = 640

function cleanCard(card: { title?: unknown; imageQuery?: unknown }) {
  const imageQuery = typeof card?.imageQuery === 'string' ? card.imageQuery.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const title = typeof card?.title === 'string' ? card.title.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  return { title, imageQuery }
}

function imageMime(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 6 && bytes.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** PNG/JPEG are resized to PNG. Electron cannot decode GIF or WebP, so those are kept as they are (the page can show them). */
function toPng(bytes: Uint8Array | Buffer): Buffer | null {
  const buffer = Buffer.from(bytes)
  let image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return imageMime(buffer) && buffer.length <= MAX_RAW_IMAGE_BYTES ? buffer : null
  if (image.getSize().width > MAX_IMAGE_WIDTH) image = image.resize({ width: MAX_IMAGE_WIDTH, quality: 'good' })
  return image.toPNG()
}

const dataUrl = (bytes: Buffer) => `data:${imageMime(bytes) ?? 'image/png'};base64,${bytes.toString('base64')}`

function readyImage(png: Buffer, info: { pageTitle?: string | null; pageUrl?: string | null; source?: string | null }): CoachImage {
  return { status: 'ready', dataUrl: dataUrl(png), pageTitle: info.pageTitle ?? undefined, pageUrl: info.pageUrl ?? undefined, source: info.source ?? undefined }
}

/** Wikipedia (through TinyFish) first; Brave only when Wikipedia has no picture. Throws only when every configured source failed. */
async function lookupImage(card: { title: string; imageQuery: string }): Promise<CoachImageLookup | null> {
  const config = getAiProviderConfig()
  const errors: unknown[] = []
  let attempted = 0
  if (config.tinyfishApiKey && config.webSearchEnabled) {
    attempted += 1
    try {
      const found = await findWikipediaImage(card, (query, signal) =>
        searchTinyFishWeb(query, config.tinyfishApiKey, { signal, maxResults: 5, includeDomains: ['wikipedia.org'] }))
      if (found) return found
    } catch (error) { errors.push(error); console.error('[Coach] Wikipedia image lookup failed:', error) }
  }
  if (config.braveApiKey) {
    attempted += 1
    try {
      for (const result of (await searchBraveImages(card.imageQuery, config.braveApiKey, { count: 4 })).slice(0, 4)) {
        const image = await fetchImageBytes(result.thumbnailUrl).catch(() => null)
        if (image) return { ...image, pageTitle: result.title, pageUrl: result.pageUrl, source: `Brave · ${result.source}` }
      }
    } catch (error) { errors.push(error); console.error('[Coach] Brave image search failed:', error) }
  }
  if (errors.length && errors.length === attempted) throw errors[0]
  return null
}

function imageSourcesAvailable() {
  const config = getAiProviderConfig()
  return Boolean(config.braveApiKey || (config.tinyfishApiKey && config.webSearchEnabled))
}

export async function getCoachImage(input: { title: string; imageQuery?: string }): Promise<CoachImage> {
  const card = cleanCard(input)
  if (!card.imageQuery && !card.title) return { status: 'none' }
  const queryKey = IMAGE_KEY_VERSION + coachImageKey(card)
  const cached = readImage(queryKey)
  if (cached?.status === 'ready' && cached.png) return readyImage(cached.png, cached)
  // Cards without a search phrase only show a picture the reader chose.
  if (!card.imageQuery) return { status: 'none' }
  if (cached?.status === 'none' && Date.now() - cached.createdAt < NONE_TTL) return { status: 'none' }
  if (!imageSourcesAvailable()) return { status: 'unavailable' }
  let found: CoachImageLookup | null
  try { found = await lookupImage(card) }
  catch { return { status: 'none' } } // network or quota trouble: do not remember a miss
  const png = found ? toPng(found.bytes) : null
  if (!found || !png) { writeImage(queryKey, { status: 'none', png: null, pageTitle: null, pageUrl: null, source: null, createdAt: Date.now() }); return { status: 'none' } }
  writeImage(queryKey, { status: 'ready', png, pageTitle: found.pageTitle, pageUrl: found.pageUrl, source: found.source, createdAt: Date.now() })
  return readyImage(png, found)
}

/** Image picker: up to three candidates, Wikipedia's picture first, then Brave results to fill the rest. */
export async function searchCoachImages(rawQuery: string): Promise<CoachImageSearchResult> {
  const query = typeof rawQuery === 'string' ? rawQuery.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  if (!query) return { candidates: [] }
  const config = getAiProviderConfig()
  const candidates: CoachImageCandidate[] = []
  let warning: string | undefined
  if (config.tinyfishApiKey && config.webSearchEnabled) {
    const found = await findWikipediaImage({ title: query, imageQuery: query }, (q, signal) =>
      searchTinyFishWeb(q, config.tinyfishApiKey, { signal, maxResults: 5, includeDomains: ['wikipedia.org'] })).catch(() => null)
    const png = found ? toPng(found.bytes) : null
    if (found && png) candidates.push({ title: found.pageTitle, dataUrl: dataUrl(png), pageUrl: found.pageUrl, source: found.source })
  }
  if (config.braveApiKey) {
    try {
      for (const result of await searchBraveImages(query, config.braveApiKey, { count: 8 })) {
        if (candidates.length >= 3) break
        const image = await fetchImageBytes(result.thumbnailUrl).catch(() => null)
        const png = image ? toPng(image.bytes) : null
        if (!png) continue
        candidates.push({ title: result.title, dataUrl: dataUrl(png), pageUrl: result.pageUrl, source: `Brave · ${result.source}` })
      }
    } catch (error) { warning = error instanceof Error ? error.message : String(error) }
  } else warning = 'Brave Search API 키를 Settings > 웹 검색에 넣으면 Wikipedia 밖의 그림도 후보로 나옵니다.'
  if (!candidates.length && !config.braveApiKey && !(config.tinyfishApiKey && config.webSearchEnabled)) warning = 'Settings > 웹 검색에서 TinyFish 또는 Brave Search API 키를 넣으면 그림을 찾을 수 있습니다.'
  return { candidates, ...(warning ? { warning } : {}) }
}

/** Keep the picture the reader chose for this card (replaces the automatic one). */
export function saveCoachImage(input: { title: string; imageQuery?: string }, candidate: CoachImageCandidate): CoachImage {
  const card = cleanCard(input)
  if (!card.imageQuery && !card.title) throw new Error('카드 정보가 올바르지 않습니다.')
  const match = typeof candidate?.dataUrl === 'string' ? /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(candidate.dataUrl) : null
  if (!match) throw new Error('그림 데이터가 올바르지 않습니다.')
  const png = toPng(Buffer.from(match[2], 'base64'))
  if (!png) throw new Error('그림을 읽지 못했습니다.')
  let pageUrl: string | null = null
  try { const url = new URL(String(candidate.pageUrl)); if (/^https?:$/.test(url.protocol)) pageUrl = url.href } catch { /* keep null */ }
  const info = { pageTitle: String(candidate.title ?? '').slice(0, 200) || card.title, pageUrl, source: String(candidate.source ?? '').slice(0, 100) || null }
  writeImage(IMAGE_KEY_VERSION + coachImageKey(card), { status: 'ready', png, ...info, createdAt: Date.now() })
  return readyImage(png, info)
}

// ─── Phase 5: memory and connections ───

const MAX_LINK_TERMS = 30

function decksFor(request: Pick<CoachLinksRequest, 'documentId' | 'deckKeys'>): CoachDeck[] {
  validateDocumentId(request?.documentId)
  if (!Array.isArray(request.deckKeys)) throw new Error('코치 요청이 올바르지 않습니다.')
  return request.deckKeys.filter(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)).slice(0, 20)
    .map(key => readDeck(key)).filter((deck): deck is CoachDeck => Boolean(deck && deck.documentId === request.documentId))
}

const excerpt = (text: string, limit = 220) => {
  const clean = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

/** Same terms in other books, and my own notes or questions about them. No model call. */
export function getCoachLinks(request: CoachLinksRequest): CoachChapterLinks {
  const decks = decksFor(request)
  const cards = decks.flatMap(deck => deck.cards)
  if (request.bookTitle) writeKv(`book:${request.documentId}`, String(request.bookTitle).slice(0, 300))
  const encounters = readEncounters(cards.map(card => coachTermKey(card)), request.documentId)
  const byCard: CoachChapterLinks['encounters'] = {}
  for (const card of cards) {
    const found = encounters.get(coachTermKey(card))
    if (found) byCard[card.id] = found
  }
  const personal: CoachPersonalLink[] = []
  const seen = new Set<string>()
  // Terms from the text (quotes) are searched; longer ones first because they are more specific.
  const terms = [...new Map(cards.map(card => [coachTermKey(card), card])).values()]
    .filter(card => coachTermKey(card).length >= 4).sort((a, b) => b.quote.length - a.quote.length).slice(0, MAX_LINK_TERMS)
  for (const card of terms) {
    // Past chat questions are no longer linked: matching them by a phrase surfaced unrelated Q&A and confused readers.
    for (const note of searchCommentaryNotes(card.quote, 2)) {
      const key = `note:${note.documentId}:${note.createdAt}`
      if (seen.has(key)) continue
      seen.add(key)
      personal.push({ cardId: card.id, source: 'commentary', bookTitle: note.documentId === request.documentId ? '이 책' : readKv(`book:${note.documentId}`, '다른 책'), excerpt: excerpt(note.markdown), at: note.createdAt })
    }
    if (personal.length >= 12) break
  }
  return { encounters: byCard, personal: personal.sort((a, b) => b.at - a.at) }
}

/** "Connector" items from long-term memory (Hindsight recall), cached for a week per chapter. */
export async function getCoachMemoryLinks(request: CoachLinksRequest): Promise<CoachMemoryLinks> {
  const decks = decksFor(request)
  const settings = getAgentMemorySettings()
  if (!settings.enabled || !settings.runtimeInjectionEnabled || !decks.length) return { status: 'off', items: [] }
  const cacheKey = `memory:${decks.map(deck => deck.key).join(',')}`
  const cached = readKv<{ at: number; items: string[] } | null>(cacheKey, null)
  if (cached && Date.now() - cached.at < 7 * 86400000) return { status: 'ok', items: cached.items }
  const health = await checkHindsightHealth(settings)
  if (!health.ok) return { status: 'error', items: [], error: health.error }
  const titles = decks.flatMap(deck => deck.cards).filter(card => ['term', 'person', 'background', 'connection', 'critique'].includes(card.kind)).slice(0, 10).map(card => card.title)
  const query = [
    `Book: ${String(request.bookTitle).slice(0, 200)} · Chapter: ${String(request.chapterTitle).slice(0, 200)}`,
    `Topics: ${[...new Set(decks.flatMap(deck => deck.domain))].join(', ')}; ${titles.join(', ')}`,
    'Need: what this reader read, asked or concluded before that connects to these topics (other books, research interests).'
  ].join('\n')
  try {
    const results = await recallHindsight(settings, query, 3)
    const items = results.map(item => excerpt(item.memory, 400)).filter(Boolean)
    writeKv(cacheKey, { at: Date.now(), items })
    return { status: 'ok', items }
  } catch (error) {
    return { status: 'error', items: [], error: error instanceof Error ? error.message : 'Hindsight recall failed' }
  }
}

export function getOpenedCards(documentId: string, chapterHref: string): string[] {
  validateDocumentId(documentId)
  return readOpenedCardIds(documentId, String(chapterHref).split('#')[0])
}

// Spaced review of the chapter's self-check questions.
export function addCoachReviews(request: CoachReviewRequest): number {
  const decks = decksFor(request)
  const now = Date.now()
  const items: CoachReviewItem[] = decks.flatMap(deck => deck.questions.map(question => ({
    id: coachHash(`${request.documentId}|${question}`) + coachHash(`${question}|${request.documentId}`),
    documentId: request.documentId, bookTitle: String(request.bookTitle).slice(0, 300),
    chapterHref: String(request.chapterHref).split('#')[0], chapterLabel: String(request.chapterLabel ?? '').slice(0, 300),
    question, recap: deck.recap, dueAt: now + 86400000, intervalDays: 1, reps: 0, createdAt: now
  })))
  return insertReviews(items)
}
export const getDueCoachReviews = () => readDueReviews(Date.now())
export function answerCoachReview(id: string, remembered: boolean): CoachReviewItem | null {
  const item = typeof id === 'string' ? readReview(id) : null
  if (!item) return null
  const intervalDays = nextReviewInterval(item.intervalDays, remembered === true)
  const next = { ...item, intervalDays, reps: item.reps + 1, dueAt: Date.now() + intervalDays * 86400000 }
  updateReview(next)
  return next
}

// The coach's summary of the reader goes into USER.md and long-term memory, so chat answers match it too.
let syncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleProfileSync() {
  if (syncTimer) return
  syncTimer = setTimeout(() => { syncTimer = null; void syncCoachProfileToMemory() }, 60000)
  syncTimer.unref?.()
}
export async function syncCoachProfileToMemory(): Promise<void> {
  const settings = getAgentMemorySettings()
  if (!settings.enabled) return
  const lines = summarizeCoachProfile(readProfile())
  if (!lines.length) return
  try {
    const changed = await replaceUserSection(COACH_PROFILE_SECTION, lines)
    const last = readKv<{ at: number; text: string } | null>('profileRetained', null)
    const text = `Reading coach profile of this reader (estimated from accepted and dismissed help cards):\n${lines.map(line => `- ${line}`).join('\n')}`
    if (!changed && last?.text === text) return
    if (last && Date.now() - last.at < 86400000) return
    const health = await checkHindsightHealth(settings)
    if (!health.ok) return
    await retainHindsightMemory(settings, {
      content: text, documentId: 'md-reader-coach-profile', context: 'Reading level and preferences inferred by the MD Reader reading coach; replaces earlier versions.',
      metadata: { source: 'reading-coach', created_at: new Date().toISOString() }
    })
    writeKv('profileRetained', { at: Date.now(), text })
  } catch (error) { console.error('[Coach] Failed to sync profile to memory:', error) }
}
