import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  COACH_USER_PART, isUserDeck, normalizeCoachText, partForVisibleText, selectCoachCards, splitChapterText,
  type CoachCard, type CoachDeck
} from '../../../../../shared/coach'
import { deckSlot, linksKey, useCoachStore, type CoachCardContext } from '../../../store/useCoachStore'
import { useChatStore } from '../../../store/useChatStore'
import { recordCardEvent } from '../utils/coachActions'
import type { CoachMarkEntry } from '../utils/epubCoachMarks'

const DWELL_MS = 20000
const OPEN_MS = 800
const HIDE_MS = 300
/** How many chapters ahead of the reader are prepared: enough to stay ahead, not the whole book. */
const PREFETCH_CHAPTERS = 3
/** Spine files looked at to find them (title pages, figures and notes are skipped). */
const PREFETCH_SCAN = 12
/** Shorter files are not counted as chapters to read ahead (they are prepared on arrival as before). */
const PREFETCH_MIN_CHARS = 1000

export interface UpcomingChapter { href: string; label: string | null; text: string }

export interface CoachCoreOptions {
  documentId: string
  bookTitle: string
  /** The chapter being read, as epub.js names it (manifest href): decks are stored under this key. */
  chapterHref: string | null
  chapterLabel: string | null
  /** Text on screen now, for the part of a long chapter and the section summaries. */
  visibleText: string
  /** Changes on every page turn; hover cards close when it does. */
  currentLocation: string | null
  /** Full text of the current chapter, split into parts for deck requests. */
  chapterText: string
  /** Other chapters on screen (a figure file next to the chapter); their own cards are loaded too. */
  extraChapters: string[]
  atChapterEnd: boolean
  resolveCard: (card: CoachCard) => CoachCardContext
  /** Text of the files after this chapter in reading order, up to `max` of them, to prepare ahead. */
  loadUpcomingChapters?: (chapterHref: string, max: number) => Promise<UpcomingChapter[]>
}

export interface CoachHoverHit { cardId: string; rect: DOMRect }
export type CoachEntry = { card: CoachCard; deck: CoachDeck }

/**
 * The part of the reading coach that does not depend on how the book is drawn: deck requests,
 * which cards to mark, dwell signals, reviews and the hover card. The 2D (epub.js) and 3D views
 * each draw the marks and report hovers in their own way.
 */
export function useCoachCore({
  documentId, bookTitle, chapterHref, chapterLabel, visibleText, currentLocation, chapterText, extraChapters, atChapterEnd, resolveCard, loadUpcomingChapters
}: CoachCoreOptions) {
  const preferences = useCoachStore(state => state.preferences)
  const profile = useCoachStore(state => state.profile)
  const suppressed = useCoachStore(state => state.suppressed)
  const decks = useCoachStore(state => state.decks)
  const links = useCoachStore(state => state.links)
  const chapter = chapterHref?.split('#')[0] ?? null

  useEffect(() => { void useCoachStore.getState().load(documentId) }, [documentId])
  useEffect(() => window.api.coach.onDeck(update => {
    if (update.documentId === useCoachStore.getState().documentId) useCoachStore.getState().applyDeckUpdate(update)
  }), [])
  useEffect(() => { useCoachStore.getState().setChapter(chapter, chapterLabel, bookTitle) }, [bookTitle, chapter, chapterLabel])

  // Cards the reader made from a selection are stored per chapter and loaded for every chapter on
  // screen, not only the current one: a figure or caption is often its own file next to it.
  const userDeckChapters = [...new Set([chapter, ...extraChapters.map(href => href?.split('#')[0])].filter((href): href is string => Boolean(href)))].sort().join('\n')
  const loadedUserDecks = useRef(new Set<string>())
  useEffect(() => {
    let active = true
    for (const href of userDeckChapters ? userDeckChapters.split('\n') : []) {
      const slot = deckSlot(documentId, href, COACH_USER_PART)
      if (loadedUserDecks.current.has(slot)) continue
      loadedUserDecks.current.add(slot)
      window.api.coach.getUserDeck(documentId, href).then(deck => {
        if (active && deck) useCoachStore.getState().applyDeckUpdate({ documentId, chapterHref: deck.chapterHref, part: COACH_USER_PART, status: 'ready', deck })
      }).catch(error => { loadedUserDecks.current.delete(slot); console.error('[Coach] Failed to load my cards:', error) })
    }
    return () => { active = false }
  }, [documentId, userDeckChapters])

  const parts = useMemo(() => splitChapterText(chapterText), [chapterText])
  const part = useMemo(() => partForVisibleText(parts, visibleText), [parts, visibleText])

  const request = useCallback((options: { force?: boolean; peek?: boolean; part?: number }) => {
    const { part: target = part, ...flags } = options
    if (!chapter || !parts[target]) return
    const model = useChatStore.getState().selectedModel
    void window.api.coach.requestDeck({
      documentId, chapterHref: chapter, part: target, partCount: parts.length, bookTitle, chapterTitle: chapterLabel ?? '', chapterText: parts[target],
      chatModel: model || 'codex:default', ...flags
    }).then(update => useCoachStore.getState().applyDeckUpdate(update))
      .catch(error => console.error('[Coach] Deck request failed:', error))
  }, [bookTitle, chapter, chapterLabel, documentId, part, parts])

  // A cached deck appears at once; a new one is made only after the reader stays on the chapter.
  const enabled = Boolean(preferences?.enabled)
  const automatic = enabled && preferences?.proactivity !== 'onDemand'
  useEffect(() => {
    if (!enabled) return
    request({ peek: true })
    if (!automatic) return
    const timer = window.setTimeout(() => {
      const slot = chapter ? useCoachStore.getState().decks[deckSlot(documentId, chapter, part)] : null
      if (!slot || slot.status === 'idle') request({})
    }, DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [automatic, chapter, documentId, enabled, part, request])

  // Long chapters: once the part being read is ready, prepare the next one so its cards are there on arrival.
  const prefetched = useRef(new Set<string>())
  const currentReady = chapter ? decks[deckSlot(documentId, chapter, part)]?.status === 'ready' : false
  useEffect(() => {
    if (!automatic || !currentReady || !chapter || !parts[part + 1]) return
    const next = deckSlot(documentId, chapter, part + 1)
    const slot = useCoachStore.getState().decks[next]
    if (prefetched.current.has(next) || (slot && slot.status !== 'idle')) return
    prefetched.current.add(next)
    request({ part: part + 1 })
  }, [automatic, chapter, currentReady, documentId, part, parts, request])

  // Reading ahead: once this chapter is settled and the reader has stayed a while, the first part of
  // the next few chapters is prepared in the background, so their cards are there on arrival.
  // Only a short window, since many books are not read to the end. Each chapter is still one call;
  // ones already prepared come from the cache, and the reader's own chapter always goes first.
  const currentStatus = chapter ? decks[deckSlot(documentId, chapter, part)]?.status : undefined
  const currentSettled = Boolean(chapter) && (!parts.length || currentStatus === 'ready' || currentStatus === 'error')
  const readAheadFrom = useRef(new Set<string>())
  useEffect(() => {
    if (!automatic || !currentSettled || !chapter || !loadUpcomingChapters) return
    const from = `${documentId}|${chapter}`
    if (readAheadFrom.current.has(from)) return
    let active = true
    const timer = window.setTimeout(() => {
      readAheadFrom.current.add(from)
      void loadUpcomingChapters(chapter, PREFETCH_SCAN).then(upcoming => {
        if (!active) { readAheadFrom.current.delete(from); return }
        const seen = new Set<string>([chapter])
        const ahead = upcoming
          .map(item => ({ ...item, href: item.href.split('#')[0] }))
          .filter(item => !seen.has(item.href) && seen.add(item.href) && item.text.trim().length >= PREFETCH_MIN_CHARS)
          .slice(0, PREFETCH_CHAPTERS)
          .map(item => ({ item, parts: splitChapterText(item.text) }))
          .filter(({ parts: chapterParts }) => chapterParts.length > 0)
        if (!ahead.length) return
        const chatModel = useChatStore.getState().selectedModel || 'codex:default'
        return window.api.coach.prefetchDecks(documentId, ahead.map(({ item, parts: chapterParts }) => ({
          documentId, chapterHref: item.href, part: 0, partCount: chapterParts.length, bookTitle, chapterTitle: item.label ?? '', chapterText: chapterParts[0], chatModel
        }))).then(updates => { for (const update of updates) useCoachStore.getState().applyDeckUpdate(update) })
      }).catch(error => { readAheadFrom.current.delete(from); console.error('[Coach] Reading ahead failed:', error) })
    }, DWELL_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [automatic, bookTitle, chapter, currentSettled, documentId, loadUpcomingChapters])

  useEffect(() => {
    useCoachStore.getState().register({ prepareCurrent: (force) => request({ force }), resolveCard })
    return () => useCoachStore.getState().register({ prepareCurrent: null, resolveCard: null })
  }, [request, resolveCard])

  const decksByChapter = useMemo(() => {
    const map = new Map<string, CoachDeck[]>()
    for (const [slot, update] of Object.entries(decks)) {
      if (!slot.startsWith(`${documentId}|`) || update.status !== 'ready' || !update.deck) continue
      map.set(update.deck.chapterHref, [...(map.get(update.deck.chapterHref) ?? []), update.deck])
    }
    return map
  }, [decks, documentId])
  // Phase 5: links to other books and my own records (local lookups, no model call).
  const chapterDecks = useMemo(() => (chapter ? decksByChapter.get(chapter) ?? [] : []).slice().sort((a, b) => a.part - b.part), [chapter, decksByChapter])
  const chapterLinksKey = linksKey(chapterDecks)
  useEffect(() => {
    if (chapterDecks.length) void useCoachStore.getState().loadLinks(chapterDecks, bookTitle, chapterLabel ?? '')
  }, [chapterLinksKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Terms the reader already marked "이미 알아요" in another book are not marked again.
  const knownElsewhere = useMemo(() => {
    const ids = new Set<string>()
    for (const value of Object.values(links)) for (const [cardId, encounters] of Object.entries(value.encounters)) if (encounters.some(item => item.known)) ids.add(cardId)
    return ids
  }, [links])
  // Self-check questions join the spaced review once the reader reaches the chapter's end.
  const reviewed = useRef(new Set<string>())
  useEffect(() => {
    if (!atChapterEnd || !chapter || !chapterDecks.some(deck => deck.questions.length) || reviewed.current.has(chapterLinksKey)) return
    reviewed.current.add(chapterLinksKey)
    void window.api.coach.addReviews({ documentId, bookTitle, chapterHref: chapter, chapterLabel: chapterLabel ?? '', deckKeys: chapterDecks.map(deck => deck.key) })
      .then(() => useCoachStore.getState().loadReviews()).catch(error => console.error('[Coach] Failed to schedule review:', error))
  }, [atChapterEnd, chapter, chapterLinksKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Which cards are marked is decided locally, without any model call. The view calls this
  // whenever its identity changes and draws the entries it returns for each chapter on screen.
  const cardIndex = useRef(new Map<string, CoachEntry>())
  const buildMarkEntries = useCallback((hrefs: string[]) => {
    const day = new Date().toDateString()
    cardIndex.current = new Map()
    const result = new Map<string, CoachMarkEntry[]>()
    // Cards the reader asked for are always marked, whatever the coach's filter says, in whichever
    // chapter on screen holds their text (a caption can live in a file next to the chapter).
    const userDecks = [...decksByChapter.values()].flat().filter(isUserDeck)
    const hidden = new Set([...suppressed, ...knownElsewhere])
    for (const rawHref of hrefs) {
      const href = rawHref.split('#')[0]
      const generated = (decksByChapter.get(href) ?? []).filter(deck => !isUserDeck(deck))
      result.set(rawHref, [...generated, ...userDecks].flatMap(deck =>
        (isUserDeck(deck)
          // A selection card is marked only in the file and at the match where the reader selected it.
          ? deck.cards.filter(card => !suppressed.has(card.id) && (!card.at || card.at.href === href))
          : selectCoachCards(deck, preferences, profile, { suppressed: hidden, day }).map(item => item.card)).map(card => {
          cardIndex.current.set(card.id, { card, deck })
          return { cardId: card.id, quote: card.quote, occurrence: card.at?.occurrence }
        })))
    }
    return result
  }, [decksByChapter, knownElsewhere, preferences, profile, suppressed])

  // Hover cards.
  const [hovered, setHovered] = useState<(CoachEntry & { rect: DOMRect }) | null>(null)
  const hideTimer = useRef<number | null>(null)
  const openTimer = useRef<number | null>(null)
  const opened = useRef(new Set<string>())
  const cardRef = useRef<HTMLDivElement>(null)
  const cancelHide = useCallback(() => { if (hideTimer.current != null) window.clearTimeout(hideTimer.current); hideTimer.current = null }, [])
  const hide = useCallback(() => {
    cancelHide()
    if (openTimer.current != null) window.clearTimeout(openTimer.current)
    openTimer.current = null
    setHovered(null)
  }, [cancelHide])
  const scheduleHide = useCallback(() => { if (hideTimer.current == null) hideTimer.current = window.setTimeout(hide, HIDE_MS) }, [hide])

  /** The view reports the mark under the pointer (or null when it leaves every mark). */
  const onMarkHover = useCallback((hit: CoachHoverHit | null) => {
    if (!hit) { scheduleHide(); return }
    const entry = cardIndex.current.get(hit.cardId)
    if (!entry) return
    cancelHide()
    setHovered({ ...entry, rect: hit.rect })
    if (openTimer.current != null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      if (opened.current.has(entry.card.id)) return
      opened.current.add(entry.card.id)
      void recordCardEvent('open', entry.card, entry.deck)
    }, OPEN_MS)
  }, [cancelHide, scheduleHide])

  /** Open a card right away (one the reader just made). */
  const showCard = useCallback((card: CoachCard, deck: CoachDeck, rect: DOMRect) => {
    cardIndex.current.set(card.id, { card, deck })
    cancelHide()
    setHovered({ card, deck, rect })
    opened.current.add(card.id)
    void recordCardEvent('open', card, deck)
  }, [cancelHide])

  useEffect(() => { hide() }, [currentLocation, hide])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && hovered) { void recordCardEvent('dismiss', hovered.card, hovered.deck); hide() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [hide, hovered])
  useEffect(() => () => { cancelHide(); if (openTimer.current != null) window.clearTimeout(openTimer.current) }, [cancelHide])

  /** Asking the AI about a passage that has no card means the coach missed something. */
  const recordMiss = useCallback((selectedText: string) => {
    if (!preferences?.enabled || !chapter) return
    const chapterDecks = decksByChapter.get(chapter) ?? []
    if (!chapterDecks.length) return
    const selected = normalizeCoachText(selectedText)
    const covered = chapterDecks.some(deck => deck.cards.some(card => selected.includes(normalizeCoachText(card.quote)) || normalizeCoachText(card.quote).includes(selected)))
    if (!covered) void useCoachStore.getState().record({ documentId, chapterHref: chapter, type: 'miss', domain: chapterDecks[0].domain })
  }, [chapter, decksByChapter, documentId, preferences?.enabled])

  return {
    chapter, buildMarkEntries, onMarkHover, showCard, hide, hovered, cardRef, recordMiss,
    hoverHandlers: { onPointerEnter: cancelHide, onPointerLeave: scheduleHide, onClose: () => { if (hovered) void recordCardEvent('dismiss', hovered.card, hovered.deck); hide() } }
  }
}
