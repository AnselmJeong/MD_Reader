import { create } from 'zustand'
import {
  COACH_USER_PART, DEFAULT_COACH_PREFERENCES, DEFAULT_COACH_SETTINGS, EMPTY_COACH_PROFILE,
  type CoachCard, type CoachChapterLinks, type CoachDeck, type CoachDeckUpdate, type CoachMemoryLinks, type CoachReviewItem, type CoachEvent, type CoachPreferences, type CoachProfile, type CoachSettings, type CoachUsage
} from '../../../shared/coach'
import type { CommentaryAnchor } from '../../../shared/commentary'

export interface CoachCardContext { anchor: CommentaryAnchor | null; paragraph: string }

interface CoachState {
  documentId: string | null
  loaded: boolean
  preferences: CoachPreferences | null
  lastPreferences: CoachPreferences | null
  settings: CoachSettings
  profile: CoachProfile
  usage: CoachUsage | null
  intakeOpen: boolean
  panel: 'chat' | 'coach'
  chapterHref: string | null
  chapterLabel: string | null
  bookTitle: string
  /** Deck updates keyed by `${documentId}|${chapterHref}#${part}`. */
  decks: Record<string, CoachDeckUpdate>
  suppressed: Set<string>
  /** Asked once per document session when behaviour contradicts the intake. */
  mismatchAsked: boolean
  /** Phase 5 links keyed by the chapter's deck keys. */
  links: Record<string, CoachChapterLinks>
  memoryLinks: Record<string, CoachMemoryLinks>
  reviews: CoachReviewItem[]
  /** Registered by the EPUB view: prepare the current chapter (force = regenerate). */
  prepareCurrent: ((force: boolean) => void) | null
  /** Registered by the EPUB view: locate a card in the rendered chapter. */
  resolveCard: ((card: CoachCard) => CoachCardContext) | null

  load: (documentId: string) => Promise<void>
  savePreferences: (preferences: CoachPreferences) => Promise<void>
  setIntakeOpen: (open: boolean) => void
  setPanel: (panel: 'chat' | 'coach') => void
  setChapter: (chapterHref: string | null, chapterLabel: string | null, bookTitle?: string) => void
  applyDeckUpdate: (update: CoachDeckUpdate) => void
  record: (event: Omit<CoachEvent, 'at'>) => Promise<void>
  suppress: (cardId: string) => void
  setMismatchAsked: () => void
  refreshUsage: () => Promise<void>
  updateSettings: (partial: Partial<CoachSettings>) => Promise<void>
  resetProfile: () => Promise<void>
  loadLinks: (decks: CoachDeck[], bookTitle: string, chapterTitle: string) => Promise<void>
  loadMemoryLinks: (decks: CoachDeck[], bookTitle: string, chapterTitle: string) => Promise<void>
  loadReviews: () => Promise<void>
  answerReview: (id: string, remembered: boolean) => Promise<void>
  register: (handlers: { prepareCurrent: CoachState['prepareCurrent']; resolveCard: CoachState['resolveCard'] }) => void
}

export const deckSlot = (documentId: string, chapterHref: string, part: number) => `${documentId}|${chapterHref.split('#')[0]}#${part}`

export const useCoachStore = create<CoachState>((set, get) => ({
  documentId: null, loaded: false, preferences: null, lastPreferences: null,
  settings: DEFAULT_COACH_SETTINGS, profile: EMPTY_COACH_PROFILE, usage: null,
  intakeOpen: false, panel: 'chat', chapterHref: null, chapterLabel: null, bookTitle: '', decks: {}, suppressed: new Set(),
  mismatchAsked: false, prepareCurrent: null, resolveCard: null, links: {}, memoryLinks: {}, reviews: [],

  load: async (documentId) => {
    if (get().documentId !== documentId) set({ documentId, loaded: false, preferences: null, suppressed: new Set(), mismatchAsked: false, intakeOpen: false })
    try {
      const [result, profile] = await Promise.all([window.api.coach.getPreferences(documentId), window.api.coach.getProfile()])
      if (get().documentId !== documentId) return
      set({
        loaded: true, preferences: result.preferences, lastPreferences: result.lastPreferences, settings: result.settings, profile,
        intakeOpen: !result.preferences && result.settings.askOnOpen
      })
    } catch (error) { console.error('[Coach] Failed to load preferences:', error) }
  },
  savePreferences: async (preferences) => {
    const documentId = get().documentId
    if (!documentId) return
    const saved = await window.api.coach.setPreferences(documentId, preferences)
    set(state => ({ preferences: saved, lastPreferences: saved.enabled ? saved : state.lastPreferences, intakeOpen: false }))
  },
  setIntakeOpen: (open) => set({ intakeOpen: open }),
  setPanel: (panel) => set({ panel }),
  setChapter: (chapterHref, chapterLabel, bookTitle) => set(state => ({ chapterHref: chapterHref?.split('#')[0] ?? null, chapterLabel, bookTitle: bookTitle ?? state.bookTitle })),
  applyDeckUpdate: (update) => set(state => {
    const slot = deckSlot(update.documentId, update.chapterHref, update.part)
    // An "idle" peek must not erase a deck that is already known.
    if (update.status === 'idle' && state.decks[slot]?.status === 'ready') return {}
    return { decks: { ...state.decks, [slot]: update } }
  }),
  record: async (event) => {
    try {
      const profile = await window.api.coach.recordEvent({ ...event, at: Date.now() })
      set({ profile })
    } catch (error) { console.error('[Coach] Failed to record event:', error) }
  },
  suppress: (cardId) => set(state => ({ suppressed: new Set([...state.suppressed, cardId]) })),
  setMismatchAsked: () => set({ mismatchAsked: true }),
  refreshUsage: async () => { try { set({ usage: await window.api.coach.getUsage() }) } catch { /* shown as unknown */ } },
  updateSettings: async (partial) => { set({ settings: await window.api.coach.setSettings(partial) }) },
  resetProfile: async () => { set({ profile: await window.api.coach.resetProfile() }) },
  loadLinks: async (decks, bookTitle, chapterTitle) => {
    const documentId = get().documentId
    if (!documentId || !decks.length) return
    const key = linksKey(decks)
    try {
      const links = await window.api.coach.getLinks({ documentId, bookTitle, chapterTitle, deckKeys: decks.map(deck => deck.key) })
      set(state => ({ links: { ...state.links, [key]: links } }))
    } catch (error) { console.error('[Coach] Failed to load links:', error) }
  },
  loadMemoryLinks: async (decks, bookTitle, chapterTitle) => {
    const documentId = get().documentId
    if (!documentId || !decks.length) return
    const key = linksKey(decks)
    try {
      const links = await window.api.coach.getMemoryLinks({ documentId, bookTitle, chapterTitle, deckKeys: decks.map(deck => deck.key) })
      set(state => ({ memoryLinks: { ...state.memoryLinks, [key]: links } }))
    } catch (error) { console.error('[Coach] Failed to load memory links:', error) }
  },
  loadReviews: async () => { try { set({ reviews: await window.api.coach.dueReviews() }) } catch { /* keep the last list */ } },
  answerReview: async (id, remembered) => {
    await window.api.coach.answerReview(id, remembered)
    set(state => ({ reviews: state.reviews.filter(item => item.id !== id) }))
  },
  register: (handlers) => set(handlers)
}))

/** Ready decks of the current chapter, all parts merged in order. */
export function currentChapterDecks(state: Pick<CoachState, 'documentId' | 'chapterHref' | 'decks'>): CoachDeck[] {
  if (!state.documentId || !state.chapterHref) return []
  const prefix = `${state.documentId}|${state.chapterHref}#`
  return Object.entries(state.decks)
    .filter(([slot, update]) => slot.startsWith(prefix) && update.status === 'ready' && update.deck)
    .map(([, update]) => update.deck!)
    .sort((a, b) => a.part - b.part)
}

export function currentChapterStatus(state: Pick<CoachState, 'documentId' | 'chapterHref' | 'decks'>): CoachDeckUpdate | null {
  if (!state.documentId || !state.chapterHref) return null
  const prefix = `${state.documentId}|${state.chapterHref}#`
  // "My cards" (selection cards) do not say anything about whether the chapter itself is prepared.
  const updates = Object.entries(state.decks).filter(([slot]) => slot.startsWith(prefix) && !slot.endsWith(`#${COACH_USER_PART}`)).map(([, update]) => update)
  return updates.find(update => update.status === 'generating') ?? updates.find(update => update.status === 'queued')
    ?? updates.find(update => update.status === 'error' || update.status === 'limited') ?? updates.find(update => update.status === 'ready') ?? null
}

export const initialPreferences = (state: Pick<CoachState, 'preferences' | 'lastPreferences'>): CoachPreferences =>
  state.preferences?.enabled ? state.preferences : state.lastPreferences ?? DEFAULT_COACH_PREFERENCES

export const linksKey = (decks: Pick<CoachDeck, 'key'>[]) => decks.map(deck => deck.key).join(',')
