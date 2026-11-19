import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contents } from 'epubjs'
import {
  normalizeCoachText, partForVisibleText, selectCoachCards, splitChapterText,
  type CoachCard, type CoachDeck
} from '../../../../../shared/coach'
import { deckSlot, useCoachStore } from '../../../store/useCoachStore'
import { useChatStore } from '../../../store/useChatStore'
import { recordCardEvent } from '../utils/coachActions'
import { attachCoachHover, coachQuoteBlock, setCoachMarks } from '../utils/epubCoachMarks'
import { sourceAnchor } from '../utils/epubCommentaryAnchors'

const DWELL_MS = 20000
const OPEN_MS = 800
const HIDE_MS = 300

interface Section { contents: Contents; chapterHref: string }
interface Options {
  documentId: string
  bookTitle: string
  chapterHref: string | null
  chapterLabel: string | null
  visibleText: string
  currentLocation: string | null
  sections: Section[]
  theme: string
}

const chapterText = (section: Section | undefined) => section?.contents.document?.body?.textContent?.replace(/[ \t]+/g, ' ') ?? ''

/** Connects the coach to the EPUB view: deck requests, marks in the iframe, hover cards and signals. */
export function useEpubCoach({ documentId, bookTitle, chapterHref, chapterLabel, visibleText, currentLocation, sections, theme }: Options) {
  const preferences = useCoachStore(state => state.preferences)
  const profile = useCoachStore(state => state.profile)
  const suppressed = useCoachStore(state => state.suppressed)
  const decks = useCoachStore(state => state.decks)
  const chapter = chapterHref?.split('#')[0] ?? null

  useEffect(() => { void useCoachStore.getState().load(documentId) }, [documentId])
  useEffect(() => window.api.coach.onDeck(update => {
    if (update.documentId === useCoachStore.getState().documentId) useCoachStore.getState().applyDeckUpdate(update)
  }), [])
  useEffect(() => { useCoachStore.getState().setChapter(chapter, chapterLabel) }, [chapter, chapterLabel])

  const currentSection = sections.find(section => section.chapterHref === chapter && section.contents.window?.frameElement?.isConnected)
  const parts = useMemo(() => splitChapterText(chapterText(currentSection)), [currentSection])
  const part = useMemo(() => partForVisibleText(parts, visibleText), [parts, visibleText])

  const request = useCallback((options: { force?: boolean; peek?: boolean }) => {
    if (!chapter || !parts[part]) return
    const model = useChatStore.getState().selectedModel
    void window.api.coach.requestDeck({
      documentId, chapterHref: chapter, part, bookTitle, chapterTitle: chapterLabel ?? '', chapterText: parts[part],
      chatModel: model || 'codex:default', ...options
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

  const resolveCard = useCallback((card: CoachCard) => {
    for (const section of sections) {
      const block = section.contents.document ? coachQuoteBlock(section.contents.document, card.quote) : null
      if (block) return { anchor: sourceAnchor(block, section.chapterHref), paragraph: normalizeCoachText(block.textContent ?? '').slice(0, 4000) }
    }
    return { anchor: null, paragraph: '' }
  }, [sections])
  useEffect(() => {
    useCoachStore.getState().register({ prepareCurrent: (force) => request({ force }), resolveCard })
    return () => useCoachStore.getState().register({ prepareCurrent: null, resolveCard: null })
  }, [request, resolveCard])

  // Marks: which cards are drawn is decided locally, without any model call.
  const decksByChapter = useMemo(() => {
    const map = new Map<string, CoachDeck[]>()
    for (const [slot, update] of Object.entries(decks)) {
      if (!slot.startsWith(`${documentId}|`) || update.status !== 'ready' || !update.deck) continue
      map.set(update.deck.chapterHref, [...(map.get(update.deck.chapterHref) ?? []), update.deck])
    }
    return map
  }, [decks, documentId])
  const cardIndex = useRef(new Map<string, { card: CoachCard; deck: CoachDeck }>())
  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || (theme === 'dark' ? '#e0a07e' : '#914c35')
    const day = new Date().toDateString()
    cardIndex.current = new Map()
    for (const section of sections) {
      if (!section.contents.document?.body) continue
      const entries = (decksByChapter.get(section.chapterHref) ?? []).flatMap(deck =>
        selectCoachCards(deck, preferences, profile, { suppressed, day }).map(({ card }) => {
          cardIndex.current.set(card.id, { card, deck })
          return { cardId: card.id, quote: card.quote }
        }))
      try { setCoachMarks(section.contents, entries, accent) } catch (error) { console.error('[Coach] Failed to draw marks:', error) }
    }
  }, [decksByChapter, preferences, profile, sections, suppressed, theme])

  // Hover cards.
  const [hovered, setHovered] = useState<{ card: CoachCard; deck: CoachDeck; rect: DOMRect } | null>(null)
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
  const attached = useRef(new WeakSet<Contents>())
  useEffect(() => {
    for (const section of sections) {
      const contents = section.contents
      if (attached.current.has(contents) || !contents.document) continue
      attached.current.add(contents)
      const detach = attachCoachHover(contents, hit => {
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
      })
      contents.window.addEventListener('unload', detach, { once: true })
    }
  }, [cancelHide, scheduleHide, sections])
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
    hovered, cardRef, recordMiss,
    hoverHandlers: { onPointerEnter: cancelHide, onPointerLeave: scheduleHide, onClose: () => { if (hovered) void recordCardEvent('dismiss', hovered.card, hovered.deck); hide() } }
  }
}
