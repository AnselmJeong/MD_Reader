import { BrowserWindow, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { chatCompletionsText, getSubscriptionStatus } from './subscription-client'
import { codexClient } from './codex/client'
import { getAiProviderConfig } from './ai-provider-settings'
import { findWikipediaImage } from './coach-image-service'
import { searchTinyFishWeb } from './tinyfish-web-search-service'
import {
  appendEvent, countUsage, readDeck, readImage, readLastPreferences, readPreferences, readProfile, readSettings, readUsage,
  writeDeck, writeImage, writePreferences, writeProfile, writeSettings
} from './coach-store'
import {
  applyCoachEvent, buildCoachDeckPrompt, coachDeckCacheInput, EMPTY_COACH_PROFILE, parseCoachDeck, sanitizePreferences,
  type CoachDeck, type CoachDeckRequest, type CoachDeckUpdate, type CoachEvent, type CoachImage, type CoachPreferences, type CoachProfile, type CoachSettings
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
    broadcast({ ...base, status: 'ready', deck })
  } catch (error) {
    countUsage('failures')
    broadcast({ ...base, status: 'error', error: error instanceof Error ? error.message : '코치 카드를 만들지 못했습니다.' })
  }
}

// ─── Pictures ───

const NONE_TTL = 30 * 86400000
export async function getCoachImage(card: { title: string; imageQuery: string }): Promise<CoachImage> {
  const imageQuery = typeof card?.imageQuery === 'string' ? card.imageQuery.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  const title = typeof card?.title === 'string' ? card.title.slice(0, 120) : ''
  if (!imageQuery) return { status: 'none' }
  const queryKey = imageQuery.toLowerCase()
  const cached = readImage(queryKey)
  if (cached?.status === 'ready' && cached.png) return { status: 'ready', dataUrl: `data:image/png;base64,${cached.png.toString('base64')}`, pageTitle: cached.pageTitle ?? undefined, pageUrl: cached.pageUrl ?? undefined }
  if (cached?.status === 'none' && Date.now() - cached.createdAt < NONE_TTL) return { status: 'none' }
  const config = getAiProviderConfig()
  if (!config.tinyfishApiKey || !config.webSearchEnabled) return { status: 'unavailable' }
  let found
  try {
    found = await findWikipediaImage({ title, imageQuery }, (query, signal) =>
      searchTinyFishWeb(query, config.tinyfishApiKey, { signal, maxResults: 5, includeDomains: ['wikipedia.org'] }))
  }
  catch (error) { console.error('[Coach] Image lookup failed:', error); return { status: 'none' } }
  if (!found) { writeImage(queryKey, { status: 'none', png: null, pageTitle: null, pageUrl: null, createdAt: Date.now() }); return { status: 'none' } }
  let image = nativeImage.createFromBuffer(Buffer.from(found.bytes))
  if (image.isEmpty()) return { status: 'none' }
  if (image.getSize().width > 480) image = image.resize({ width: 480, quality: 'good' })
  const png = image.toPNG()
  writeImage(queryKey, { status: 'ready', png, pageTitle: found.pageTitle, pageUrl: found.pageUrl, createdAt: Date.now() })
  return { status: 'ready', dataUrl: `data:image/png;base64,${png.toString('base64')}`, pageTitle: found.pageTitle, pageUrl: found.pageUrl }
}
