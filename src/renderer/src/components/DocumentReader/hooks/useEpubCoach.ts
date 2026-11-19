import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contents } from 'epubjs'
import {
  COACH_USER_PART, isUserDeck, normalizeCoachText, partForVisibleText, selectCoachCards, splitChapterText,
  type CoachCard, type CoachDeck
} from '../../../../../shared/coach'
import { deckSlot, linksKey, useCoachStore } from '../../../store/useCoachStore'
import { useChatStore } from '../../../store/useChatStore'
import { recordCardEvent } from '../utils/coachActions'
import { attachCoachHover, coachMarkColor, coachQuoteBlock, setCoachMarks } from '../utils/epubCoachMarks'
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
  atChapterEnd: boolean
}

const chapterText = (section: Section | undefined) => section?.contents.document?.body?.textContent?.replace(/[ \t]+/g, ' ') ?? ''

/** Connects the coach to the EPUB view: deck requests, marks in the iframe, hover cards and signals. */
export function useEpubCoach({ documentId, bookTitle, chapterHref, chapterLabel, visibleText, currentLocation, sections, theme, atChapterEnd }: Options) {
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

  // Cards the reader made from a selection are stored per chapter and always loaded.
  useEffect(() => {
    if (!chapter) return
    let active = true
    window.api.coach.getUserDeck(documentId, chapter).then(deck => {
      if (active && deck) useCoachStore.getState().applyDeckUpdate({ documentId, chapterHref: deck.chapterHref, part: COACH_USER_PART, status: 'ready', deck })
    }).catch(error => console.error('[Coach] Failed to load my cards:', error))
    return () => { active = false }
  }, [chapter, documentId])

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

  const cardIndex = useRef(new Map<string, { card: CoachCard; deck: CoachDeck }>())
  useEffect(() => {
    const accent = coachMarkColor(theme)
    const day = new Date().toDateString()
    cardIndex.current = new Map()
    for (const section of sections) {
      if (!section.contents.document?.body) continue
      const hidden = new Set([...suppressed, ...knownElsewhere])
      const entries = (decksByChapter.get(section.chapterHref) ?? []).flatMap(deck =>
        // Cards the reader asked for are always marked, whatever the coach's filter says.
        (isUserDeck(deck) ? deck.cards.filter(card => !suppressed.has(card.id)) : selectCoachCards(deck, preferences, profile, { suppressed: hidden, day }).map(item => item.card)).map(card => {
          cardIndex.current.set(card.id, { card, deck })
          return { cardId: card.id, quote: card.quote }
        }))
      try { setCoachMarks(section.contents, entries, accent) } catch (error) { console.error('[Coach] Failed to draw marks:', error) }
    }
  }, [decksByChapter, knownElsewhere, preferences, profile, sections, suppressed, theme])

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

  /** "코치 카드" in the selection menu: ask the coach for a card about the selected text. */
  const [pendingCard, setPendingCard] = useState<{ rect: DOMRect; text: string; error?: string } | null>(null)
  const pendingRun = useRef(0)
  const createCardFromSelection = useCallback(async (contents: Contents, selectedText: string, rect: DOMRect) => {
    const section = sections.find(item => item.contents === contents) ?? currentSection
    const chapterHrefForCard = section?.chapterHref ?? chapter
    if (!chapterHrefForCard) return
    const run = ++pendingRun.current
    hide()
    setPendingCard({ rect, text: selectedText })
    try {
      const block = contents.document ? coachQuoteBlock(contents.document, selectedText) : null
      const { deck, card } = await window.api.coach.createSelectionCard({
        documentId, chapterHref: chapterHrefForCard, bookTitle, chapterTitle: chapterLabel ?? '', selectedText,
        paragraph: normalizeCoachText(block?.textContent ?? '').slice(0, 3000), chatModel: useChatStore.getState().selectedModel || 'codex:default'
      })
      useCoachStore.getState().applyDeckUpdate({ documentId, chapterHref: deck.chapterHref, part: COACH_USER_PART, status: 'ready', deck })
      if (run !== pendingRun.current) return
      setPendingCard(null)
      cardIndex.current.set(card.id, { card, deck })
      cancelHide()
      setHovered({ card, deck, rect })
      opened.current.add(card.id)
      void recordCardEvent('open', card, deck)
    } catch (error) {
      if (run === pendingRun.current) setPendingCard({ rect, text: selectedText, error: error instanceof Error ? error.message : String(error) })
    }
  }, [bookTitle, cancelHide, chapter, chapterLabel, currentSection, documentId, hide, sections])
  const closePending = useCallback(() => { pendingRun.current += 1; setPendingCard(null) }, [])
  useEffect(() => { if (pendingCard?.error) closePending() }, [currentLocation]) // eslint-disable-line react-hooks/exhaustive-deps

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
    hovered, cardRef, recordMiss, createCardFromSelection, pendingCard, closePending,
    hoverHandlers: { onPointerEnter: cancelHide, onPointerLeave: scheduleHide, onClose: () => { if (hovered) void recordCardEvent('dismiss', hovered.card, hovered.deck); hide() } }
  }
}
