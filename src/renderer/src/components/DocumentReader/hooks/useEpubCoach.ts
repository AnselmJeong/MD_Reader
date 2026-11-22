import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contents } from 'epubjs'
import { COACH_USER_PART, normalizeCoachText, type CoachCard } from '../../../../../shared/coach'
import { useCoachStore } from '../../../store/useCoachStore'
import { useChatStore } from '../../../store/useChatStore'
import { attachCoachHover, coachMarkColor, coachQuoteBlock, selectionOccurrence, setCoachMarks } from '../utils/epubCoachMarks'
import { sourceAnchor } from '../utils/epubCommentaryAnchors'
import { useCoachCore } from './useCoachCore'

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

/** The DOM range of the reader's selection: from its CFI, or the live selection if that fails. */
function selectedRange(contents: Contents, cfiRange?: string): Range | null {
  if (cfiRange) {
    try {
      const range = (contents as unknown as { range: (cfi: string) => Range | null }).range(cfiRange)
      if (range) return range
    } catch { /* fall back to the live selection */ }
  }
  const selection = contents.window?.getSelection()
  return selection && selection.rangeCount ? selection.getRangeAt(0) : null
}

const chapterText = (section: Section | undefined) => section?.contents.document?.body?.textContent?.replace(/[ \t]+/g, ' ') ?? ''

/** Connects the coach to the 2D EPUB view: marks in the iframe, hover detection and cards from a selection. */
export function useEpubCoach({ documentId, bookTitle, chapterHref, chapterLabel, visibleText, currentLocation, sections, theme, atChapterEnd }: Options) {
  const chapter = chapterHref?.split('#')[0] ?? null
  const currentSection = sections.find(section => section.chapterHref === chapter && section.contents.window?.frameElement?.isConnected)
  const currentText = useMemo(() => chapterText(currentSection), [currentSection])
  const extraChapters = useMemo(() => sections.map(section => section.chapterHref), [sections])

  const resolveCard = useCallback((card: CoachCard) => {
    for (const section of sections) {
      if (card.at && card.at.href !== section.chapterHref.split('#')[0]) continue
      const block = section.contents.document ? coachQuoteBlock(section.contents.document, card.quote, card.at?.occurrence) : null
      if (block) return { anchor: sourceAnchor(block, section.chapterHref), paragraph: normalizeCoachText(block.textContent ?? '').slice(0, 4000) }
    }
    return { anchor: null, paragraph: '' }
  }, [sections])

  const core = useCoachCore({
    documentId, bookTitle, chapterHref, chapterLabel, visibleText, currentLocation, atChapterEnd,
    chapterText: currentText, extraChapters, resolveCard
  })
  const { buildMarkEntries, onMarkHover, showCard, hide } = core

  // Marks in each rendered chapter, painted with the CSS Custom Highlight API.
  useEffect(() => {
    const accent = coachMarkColor(theme)
    const live = sections.filter(section => section.contents.document?.body)
    const entries = buildMarkEntries(live.map(section => section.chapterHref))
    for (const section of live) {
      try { setCoachMarks(section.contents, entries.get(section.chapterHref) ?? [], accent) } catch (error) { console.error('[Coach] Failed to draw marks:', error) }
    }
  }, [buildMarkEntries, sections, theme])

  const attached = useRef(new WeakSet<Contents>())
  useEffect(() => {
    for (const section of sections) {
      const contents = section.contents
      if (attached.current.has(contents) || !contents.document) continue
      attached.current.add(contents)
      const detach = attachCoachHover(contents, onMarkHover)
      contents.window.addEventListener('unload', detach, { once: true })
    }
  }, [onMarkHover, sections])

  /** "코치 카드" in the selection menu: ask the coach for a card about the selected text. */
  const [pendingCard, setPendingCard] = useState<{ rect: DOMRect; text: string; error?: string } | null>(null)
  const pendingRun = useRef(0)
  const createCardFromSelection = useCallback(async (contents: Contents, selectedText: string, rect: DOMRect, cfiRange?: string) => {
    // Saved under the chapter being read, so it is listed in the coach tab with that chapter's cards.
    const section = sections.find(item => item.contents === contents) ?? currentSection
    const chapterHrefForCard = chapter ?? section?.chapterHref
    if (!chapterHrefForCard) return
    const run = ++pendingRun.current
    hide()
    setPendingCard({ rect, text: selectedText })
    // Remember where the selection is: the same words often appear earlier in the chapter (a title,
    // a heading, an earlier mention), and the card must be marked here, not at the first match.
    const range = selectedRange(contents, cfiRange)
    // Same 300-character cut as the card's quote, so the count matches what is marked later.
    const quote = selectedText.replace(/\s+/g, ' ').trim().slice(0, 300)
    const { occurrence, block } = contents.document ? selectionOccurrence(contents.document, quote, range) : { occurrence: 0, block: null }
    const sectionHref = section?.chapterHref.split('#')[0]
    try {
      const { deck, card } = await window.api.coach.createSelectionCard({
        documentId, chapterHref: chapterHrefForCard, bookTitle, chapterTitle: chapterLabel ?? '', selectedText,
        paragraph: normalizeCoachText(block?.textContent ?? '').slice(0, 3000), chatModel: useChatStore.getState().selectedModel || 'codex:default',
        ...(sectionHref ? { at: { href: sectionHref, occurrence } } : {})
      })
      useCoachStore.getState().applyDeckUpdate({ documentId, chapterHref: deck.chapterHref, part: COACH_USER_PART, status: 'ready', deck })
      if (run !== pendingRun.current) return
      setPendingCard(null)
      showCard(card, deck, rect)
    } catch (error) {
      if (run === pendingRun.current) setPendingCard({ rect, text: selectedText, error: error instanceof Error ? error.message : String(error) })
    }
  }, [bookTitle, chapter, chapterLabel, currentSection, documentId, hide, sections, showCard])
  const closePending = useCallback(() => { pendingRun.current += 1; setPendingCard(null) }, [])
  useEffect(() => { if (pendingCard?.error) closePending() }, [currentLocation]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    hovered: core.hovered, cardRef: core.cardRef, recordMiss: core.recordMiss, hoverHandlers: core.hoverHandlers,
    createCardFromSelection, pendingCard, closePending
  }
}
