import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isReaderInteractionBlocked } from '../../lib/readerInteraction'
import { normalizeCoachText, type CoachCard } from '../../../../shared/coach'
import { EpubAdapter } from '../../book3d/adapters/epub/epubAdapter'
import { LOGICAL_PAGE_HEIGHT, LOGICAL_PAGE_WIDTH } from '../../book3d/adapters/epub/epubPaginator'
import { BookStage } from '../../book3d/stage/bookStage'
import { GestureController } from '../../book3d/ui/gestureController'
import type { DisplaySettings, ThemeMode, TocItem, TypographySettings } from '../../book3d/types/book'
import { useDocumentStore, type EpubDocumentTab } from '../../store/useDocumentStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUIStore } from '../../store/useUIStore'
import { useCoachStore } from '../../store/useCoachStore'
import { ReadingPaneFooter, ReadingPaneHeader, ReadingSensesPanel } from './ReadingChrome'
import { CoachIntakeDialog } from './CoachIntakeDialog'
import { CoachHoverCard } from './CoachCard'
import { CoachRail } from './CoachRail'
import { useCoachCore, type CoachHoverHit } from './hooks/useCoachCore'
import { coachQuoteBlock } from './utils/epubCoachMarks'
import { sourceAnchor } from './utils/epubCommentaryAnchors'
import { cfiForCompactOffset, chapterTextIndex, compactOffsetOfCfi, mapCompactOffset } from './utils/epub3dPositions'

// The 3D view is for relaxed reading: pages turn like a hardcover book and coach cards appear over
// it, but there is no selection, highlighting, notes or search. Those stay in 2D, and switching
// keeps the reading position.

const DISPLAY: Omit<DisplaySettings, 'theme'> = {
  curvature: 0.65,
  shadowStrength: 0.55,
  bleedThrough: false,
  bleedStrength: 0.18,
  bindingColor: '#6a3326',
  showPerfHud: false
}

const SAVE_DELAY_MS = 500
const RELAYOUT_DELAY_MS = 120

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function typographyFor(fontSize: number, lineHeight: number, fontFamily: string): TypographySettings {
  return {
    fontPreset: 'serif-classic',
    fontSizePx: fontSize,
    lineHeight,
    marginPreset: 'balanced',
    textAlign: 'justify',
    fontFamily: fontFamily || 'Newsreader'
  }
}

/**
 * Canvas layout measures text, so the faces it will draw with must be loaded before pages are cut.
 * Web fonts (Korean ones especially) come in unicode-range pieces that load only for the text asked.
 */
async function waitForFont(family: string, size: number, text = 'Aa가'): Promise<void> {
  if (!('fonts' in document)) return
  const timeout = new Promise<void>(resolve => window.setTimeout(resolve, 4000))
  const families = [family.replaceAll('"', ''), 'Noto Serif KR']
  const load = Promise.all(families.flatMap(name => ['400', '600', 'italic 400'].map(style =>
    document.fonts.load(`${style} ${size}px "${name}"`, text).catch(() => [])
  ))).then(() => document.fonts.ready).then(() => undefined).catch(() => undefined)
  await Promise.race([load, timeout])
}

/** Same blue-teal family as the 2D coach marks, but deeper: the 3D page is lit and tone-mapped, which washes colours out. */
function coachMarkColor3D(theme: string): string {
  if (theme === 'dark') return 'oklch(0.8 0.13 215)'
  if (theme === 'sepia') return 'oklch(0.45 0.15 225)'
  return 'oklch(0.47 0.18 245)'
}

const chapterTextOf = (doc: Document | null) => doc?.body?.textContent?.replace(/[ \t]+/g, ' ') ?? ''

interface PageInfo {
  page: number
  total: number
  /** Chapters (spine items) on the two visible pages, left first. */
  spines: number[]
}

interface MarkHit { cardId: string; page: number; x: number; y: number; width: number; height: number }

export function Epub3DView({ tab }: { tab: EpubDocumentTab }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<BookStage | null>(null)
  const adapterRef = useRef<EpubAdapter | null>(null)
  const initialPageRef = useRef<number | null>(null)
  const { theme, fontSize, lineHeight, readerFontFamily } = useSettingsStore()
  const { showToC, toggleToC, toggleFocusMode, focusMode, showSearch, setShowSearch, setEpubViewMode } = useUIStore()
  const { updateEpubContent, updateEpubLocation } = useDocumentStore()
  const coachEnabled = useCoachStore(state => Boolean(state.preferences?.enabled))

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [title, setTitle] = useState(tab.fileName.replace(/\.[^.]+$/, ''))
  const [toc, setToc] = useState<TocItem[]>([])
  const [info, setInfo] = useState<PageInfo>({ page: 0, total: 0, spines: [] })
  /** Bumped after every (re)layout: marks and texts are recomputed for the new pages. */
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [toast, setToast] = useState('')
  const bookBuffer = useMemo(() => base64ToArrayBuffer(tab.epubBase64), [tab.epubBase64])

  const typographyRef = useRef(typographyFor(fontSize, lineHeight, readerFontFamily))
  typographyRef.current = typographyFor(fontSize, lineHeight, readerFontFamily)
  const themeRef = useRef<ThemeMode>(theme)
  themeRef.current = theme

  const showToast = useCallback((message: string) => setToast(message), [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const describePage = useCallback((page: number): PageInfo => {
    const adapter = adapterRef.current
    if (!adapter) return { page, total: 0, spines: [] }
    const left = page - (page % 2)
    const spines = [left, left + 1].map(index => adapter.getPageSpine(index)).filter(index => index >= 0)
    return { page, total: adapter.getPageCount(), spines: [...new Set(spines)] }
  }, [])

  // ─── Where to open: the 2D position (CFI) found again in the 3D layout ───
  const initialPage = useCallback((adapter: EpubAdapter): number => {
    const total = adapter.getPageCount()
    const spine = adapter.getSpineIndexForHref(tab.currentChapterHref)
    if (spine >= 0) {
      const doc = adapter.getChapterDocument(spine)
      const offset = doc && tab.currentLocation ? compactOffsetOfCfi(doc, tab.currentLocation) : null
      if (doc && offset != null) {
        const mapped = mapCompactOffset(chapterTextIndex(doc).text, adapter.getSpineTextIndex(spine).text, offset)
        return adapter.getPageForCompactOffset(spine, mapped)
      }
      return adapter.getPageIndexForSpine(spine)
    }
    const progress = tab.lastProgress ?? 0
    return Math.max(0, Math.min(total - 1, Math.round(progress * (total - 1))))
  }, [tab.currentChapterHref, tab.currentLocation, tab.lastProgress])

  // ─── Mount: stage, gestures, book ───
  const hoverHitRef = useRef<(clientX: number, clientY: number) => MarkHit | null>(() => null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    setStatus('loading')
    const stage = new BookStage(host, { ...DISPLAY, theme: themeRef.current }, {
      onPageChanged: (page) => { if (!disposed) setInfo(describePage(page)) }
    })
    stageRef.current = stage
    const gestures = new GestureController(stage, {
      isTapBlocked: (event) => hoverHitRef.current(event.clientX, event.clientY) != null
    })
    const fitLayout = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width > 0 && height > 0) stage.setLayoutMode(width / height < 0.92 ? 'single' : 'spread')
      stage.handleResize()
    }
    const resizeObserver = new ResizeObserver(() => fitLayout())
    resizeObserver.observe(host)

    void (async () => {
      try {
        const typography = typographyRef.current
        await waitForFont(typography.fontFamily ?? 'Newsreader', typography.fontSizePx)
        const adapter = await EpubAdapter.fromBuffer(bookBuffer, typography)
        if (disposed) { adapter.dispose(); return }
        // Load the glyphs this book uses, then cut the pages again with true measurements.
        await waitForFont(typography.fontFamily ?? 'Newsreader', typography.fontSizePx, adapter.getDistinctCharacters())
        if (disposed) { adapter.dispose(); return }
        await adapter.relayout(typography, adapter.getAnchorForPage(0))
        adapterRef.current = adapter
        // For smoke tests: lets a test read the layout and draw pages without the 3D scene.
        ;(window as unknown as { __mdReader3dAdapter?: EpubAdapter }).__mdReader3dAdapter = adapter
        setTitle(adapter.metadata.title || tab.fileName.replace(/\.[^.]+$/, ''))
        setToc([...adapter.metadata.toc])
        const page = initialPage(adapter)
        initialPageRef.current = page
        fitLayout()
        stage.setDocument(adapter, page)
        setInfo(describePage(stage.getCurrentPageIndex()))
        setLayoutVersion(version => version + 1)
        setStatus('ready')
      } catch (cause) {
        if (disposed) return
        console.error('[3D] Failed to open EPUB:', cause)
        setError(cause instanceof Error ? cause.message : String(cause))
        setStatus('error')
      }
    })()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      gestures.dispose()
      stage.dispose()
      adapterRef.current?.dispose()
      adapterRef.current = null
      stageRef.current = null
    }
    // The book is opened once per tab; typography and theme changes are applied below.
  }, [bookBuffer]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Theme and typography ───
  useEffect(() => {
    stageRef.current?.applyDisplaySettings({ ...DISPLAY, theme })
  }, [theme])

  const typographyKey = `${fontSize}|${lineHeight}|${readerFontFamily}`
  const appliedTypography = useRef(typographyKey)
  useEffect(() => {
    if (status !== 'ready' || appliedTypography.current === typographyKey) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const adapter = adapterRef.current
      const stage = stageRef.current
      if (!adapter || !stage) return
      const typography = typographyRef.current
      await waitForFont(typography.fontFamily ?? 'Newsreader', typography.fontSizePx, adapter.getDistinctCharacters())
      if (cancelled) return
      const anchor = adapter.getAnchorForPage(stage.getCurrentPageIndex())
      const page = await adapter.relayout(typography, anchor)
      if (cancelled) return
      appliedTypography.current = typographyKey
      stage.onDocumentRelayout(page)
      setToc([...adapter.metadata.toc])
      setLayoutVersion(version => version + 1)
    }, RELAYOUT_DELAY_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [status, typographyKey])

  // ─── What is on screen ───
  const adapter = status === 'ready' ? adapterRef.current : null
  const spineItems = useMemo(() => adapter?.getSpineItems() ?? [], [adapter])
  const leftPage = info.page - (info.page % 2)
  const visiblePages = useMemo(() => [leftPage, leftPage + 1].filter(page => page < info.total), [leftPage, info.total])
  // The chapter being read is the left page's, unless a new chapter opens on the right page
  // (then the left page only holds the end of the previous one).
  const currentSpine = useMemo(() => {
    const last = info.spines[info.spines.length - 1]
    if (adapter && info.spines.length > 1 && adapter.getPageIndexForSpine(last) === leftPage + 1) return last
    return info.spines[0] ?? -1
  }, [adapter, info.spines, leftPage])
  const chapterHref = currentSpine >= 0 ? spineItems[currentSpine]?.href ?? null : null
  const chapterLabel = useMemo(() => {
    if (currentSpine < 0) return null
    return toc.find(item => item.spineIndex === currentSpine)?.label ?? spineItems[currentSpine]?.chapterTitle ?? null
  }, [currentSpine, spineItems, toc])
  const visibleText = useMemo(
    () => adapter ? visiblePages.map(page => adapter.getPageText(page)).join('\n\n') : '',
    [adapter, visiblePages, layoutVersion] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const atChapterEnd = useMemo(() => {
    if (!adapter || currentSpine < 0) return false
    const range = adapter.getSpinePageRange(info.spines[info.spines.length - 1])
    return Boolean(range && visiblePages.includes(range[1]))
  }, [adapter, currentSpine, info.spines, visiblePages])
  const chapterDoc = useMemo(() => (adapter && currentSpine >= 0 ? adapter.getChapterDocument(currentSpine) : null), [adapter, currentSpine])
  const chapterText = useMemo(() => chapterTextOf(chapterDoc), [chapterDoc])
  const visibleHrefs = useMemo(() => info.spines.map(spine => spineItems[spine]?.href).filter((href): href is string => Boolean(href)), [info.spines, spineItems])
  const progress = info.total > 1 ? info.page / (info.total - 1) : 0
  const hasPreciseOnlyContent = useMemo(() => {
    if (!adapter) return false
    return info.spines.some(spine => Boolean(adapter.getChapterDocument(spine)?.querySelector('table')))
  }, [adapter, info.spines])

  // Keep the chat's view of "the text on screen" current, as 2D does.
  useEffect(() => {
    if (visibleText) updateEpubContent(tab.id, visibleText)
  }, [tab.id, updateEpubContent, visibleText])

  // ─── Saving the position (as a CFI 2D understands) ───
  useEffect(() => {
    const current = adapterRef.current
    if (!current || status !== 'ready' || currentSpine < 0) return
    // Opening 3D does not overwrite the exact 2D position: only an actual page turn does.
    if (initialPageRef.current != null && Math.floor(initialPageRef.current / 2) === Math.floor(info.page / 2)) return
    initialPageRef.current = null
    const timer = window.setTimeout(() => {
      const start = current.getCompactOffsetForPage(leftPage)
      const spine = start?.spineIndex ?? currentSpine
      const doc = current.getChapterDocument(spine)
      const item = spineItems[spine]
      if (!start || !doc || !item) return
      const docOffset = mapCompactOffset(current.getSpineTextIndex(spine).text, chapterTextIndex(doc).text, start.offset)
      const cfi = cfiForCompactOffset(doc, docOffset, item.cfiBase)
      const label = toc.find(entry => entry.spineIndex === spine)?.label ?? item.chapterTitle ?? null
      updateEpubLocation(tab.id, cfi, item.href, label, progress)
      if (!cfi) return
      void window.api.epub.saveProgress({
        documentId: tab.documentHash, fileName: tab.fileName, filePath: tab.filePath,
        cfi, chapterHref: item.href, chapterLabel: label, progress
      }).catch(cause => console.error('[3D] Failed to save reading progress:', cause))
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [currentSpine, info.page, leftPage, progress, spineItems, status, tab.documentHash, tab.fileName, tab.filePath, tab.id, toc, updateEpubLocation])

  // ─── Coach ───
  const resolveCard = useCallback((card: CoachCard) => {
    const current = adapterRef.current
    if (!current) return { anchor: null, paragraph: '' }
    for (const spine of info.spines) {
      const item = spineItems[spine]
      if (!item || (card.at && card.at.href !== item.href)) continue
      const doc = current.getChapterDocument(spine)
      const block = doc ? coachQuoteBlock(doc, card.quote, card.at?.occurrence) : null
      if (block) return { anchor: sourceAnchor(block, item.href), paragraph: normalizeCoachText(block.textContent ?? '').slice(0, 4000) }
    }
    return { anchor: null, paragraph: '' }
  }, [info.spines, spineItems])

  const coach = useCoachCore({
    documentId: tab.documentHash, bookTitle: title, chapterHref, chapterLabel, visibleText,
    currentLocation: `3d:${leftPage}:${layoutVersion}`, chapterText, extraChapters: visibleHrefs, atChapterEnd, resolveCard
  })
  const { buildMarkEntries, onMarkHover } = coach

  // Underlines are drawn into the page textures of the chapters on screen.
  useEffect(() => {
    const current = adapterRef.current
    const stage = stageRef.current
    if (!current || !stage || status !== 'ready') return
    const entries = buildMarkEntries(visibleHrefs)
    const byPage = new Map<number, ReturnType<EpubAdapter['getMarksForPage']>>()
    let missing = 0
    let total = 0
    info.spines.forEach((spine) => {
      const href = spineItems[spine]?.href
      const list = href ? entries.get(href) ?? [] : []
      total += list.length
      const found = current.findQuoteMarks(spine, list)
      missing += found.missing
      for (const [page, rects] of found.byPage) byPage.set(page, [...(byPage.get(page) ?? []), ...rects])
    })
    if (missing > 0) console.info(`[Coach 3D] ${missing} of ${total} marked quotes were not found in the 3D layout and are not underlined.`)
    const changed = current.setMarks(byPage, coachMarkColor3D(theme))
    if (changed.length) stage.repaintPages(changed)
  }, [buildMarkEntries, info.spines, layoutVersion, spineItems, status, theme, visibleHrefs])

  // Hover: the pointer is raycast onto the open pages and compared with the underlines.
  const markAt = useCallback((clientX: number, clientY: number): MarkHit | null => {
    const stage = stageRef.current
    const current = adapterRef.current
    if (!stage || !current) return null
    const pick = stage.pickPage(clientX, clientY)
    if (!pick) return null
    const x = pick.u * LOGICAL_PAGE_WIDTH
    const y = (1 - pick.v) * LOGICAL_PAGE_HEIGHT
    const mark = current.getMarksForPage(pick.pageIndex).find(rect => x >= rect.x - 1 && x <= rect.x + rect.width + 1 && y >= rect.y - 2 && y <= rect.y + rect.height + 4)
    return mark ? { cardId: mark.cardId, page: pick.pageIndex, x: mark.x, y: mark.y, width: mark.width, height: mark.height } : null
  }, [])
  hoverHitRef.current = markAt

  useEffect(() => {
    const host = hostRef.current
    if (!host || status !== 'ready') return
    let frame = 0
    let last: PointerEvent | null = null
    let current: string | null = null
    const report = (hit: CoachHoverHit | null) => onMarkHover(hit)
    const check = () => {
      frame = 0
      const event = last
      const stage = stageRef.current
      if (!event || !stage || event.buttons !== 0) return
      const hit = markAt(event.clientX, event.clientY)
      host.style.cursor = hit ? 'help' : ''
      if (!hit) {
        if (current !== null) { current = null; report(null) }
        return
      }
      if (current === hit.cardId) return
      current = hit.cardId
      const corners = [
        stage.pagePointToClient(hit.page, hit.x / LOGICAL_PAGE_WIDTH, 1 - hit.y / LOGICAL_PAGE_HEIGHT),
        stage.pagePointToClient(hit.page, (hit.x + hit.width) / LOGICAL_PAGE_WIDTH, 1 - hit.y / LOGICAL_PAGE_HEIGHT),
        stage.pagePointToClient(hit.page, hit.x / LOGICAL_PAGE_WIDTH, 1 - (hit.y + hit.height) / LOGICAL_PAGE_HEIGHT),
        stage.pagePointToClient(hit.page, (hit.x + hit.width) / LOGICAL_PAGE_WIDTH, 1 - (hit.y + hit.height) / LOGICAL_PAGE_HEIGHT)
      ].filter((point): point is { x: number; y: number } => point != null)
      if (!corners.length) return
      const left = Math.min(...corners.map(point => point.x))
      const top = Math.min(...corners.map(point => point.y))
      const right = Math.max(...corners.map(point => point.x))
      const bottom = Math.max(...corners.map(point => point.y))
      report({ cardId: hit.cardId, rect: new DOMRect(left, top, right - left, bottom - top) })
    }
    const move = (event: PointerEvent) => { last = event; if (!frame) frame = requestAnimationFrame(check) }
    const leave = () => {
      host.style.cursor = ''
      if (current !== null) { current = null; report(null) }
    }
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
    }
  }, [markAt, onMarkHover, status])

  // ─── Keys: page turns only (2D keeps its own shortcuts) ───
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isReaderInteractionBlocked(hostRef.current)) return
      const target = event.target as HTMLElement | null
      if (event.defaultPrevented || target?.closest('input, textarea, select, [contenteditable="true"], [data-commentary-ui]')) return
      const stage = stageRef.current
      if (!stage) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        showToast('검색은 2D 보기에서 할 수 있습니다.')
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target?.closest('button, a, [role="button"], [role="slider"], [role="menuitem"]')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); stage.nextPage() }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); stage.prevPage() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showToast])

  // Search lives in 2D; a search opened from elsewhere is closed here with a short note.
  useEffect(() => {
    if (!showSearch) return
    setShowSearch(false)
    showToast('검색은 2D 보기에서 할 수 있습니다.')
  }, [setShowSearch, showSearch, showToast])

  const goToTocItem = useCallback((item: TocItem) => {
    const current = adapterRef.current
    if (!current) return
    stageRef.current?.goToPage(item.pageIndex ?? current.getPageIndexForSpine(item.spineIndex), false)
  }, [])

  const label = chapterLabel ?? title
  const pageLabel = info.total > 0 ? `${Math.min(info.total, leftPage + 1)}–${Math.min(info.total, leftPage + 2)} / ${info.total}쪽` : '3D'

  return (
    <div className={`reading-stage epub-reading-stage epub-3d-stage ${focusMode ? 'focus-mode' : ''}`}>
      <ReadingPaneHeader label={label} progress={progress} showToC={showToC} onToggleFocusMode={toggleFocusMode} onToggleToC={toggleToC} />

      {showToC && (
        <div className="reading-toc-panel">
          <div className="h-full w-72 shrink-0 overflow-y-auto border-r border-border bg-surface-alt">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface-alt px-4 py-3">
              <span className="small-caps text-on-surface">Contents</span>
              <button onClick={toggleToC} className="rounded px-1 text-on-surface-muted transition-colors hover:bg-[var(--ink-3)] hover:text-on-surface" aria-label="목차 닫기">
                <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
            <div className="p-3">
              {toc.length > 0 ? toc.map((item, index) => (
                <button key={`${item.href}-${index}`} onClick={() => goToTocItem(item)}
                  className="w-full truncate rounded-md px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--ink-3)] ui-text"
                  style={{ paddingLeft: `${Math.min(item.depth, 4) * 16 + 12}px` }} title={item.label}>
                  <span className={item.depth === 0 ? 'font-semibold text-on-surface' : 'text-on-surface-muted'}>{item.label}</span>
                </button>
              )) : <p className="px-3 py-2 text-[12px] text-on-surface-muted">No EPUB contents found.</p>}
            </div>
          </div>
        </div>
      )}

      <div className="reading-viewport epub-3d-viewport">
        <div ref={hostRef} className="epub-3d-host" aria-label="3D 책" />
        {status === 'loading' && <div className="epub-3d-status ui-text">3D 책을 준비하는 중…</div>}
        {status === 'error' && (
          <div className="epub-3d-status ui-text">
            <p>3D로 열 수 없는 책입니다.</p>
            <p className="text-on-surface-muted">{error}</p>
            <button onClick={() => setEpubViewMode('2d')}>2D로 보기</button>
          </div>
        )}
        {status === 'ready' && hasPreciseOnlyContent && (
          <div className="epub-3d-note ui-text">이 장의 표는 2D에서 정확히 보입니다.</div>
        )}
        {toast && <div className="epub-3d-toast ui-text" role="status">{toast}</div>}
      </div>

      <button onClick={() => stageRef.current?.prevPage()} className="epub-page-button epub-page-button-left" title="Previous page">‹</button>
      <button onClick={() => stageRef.current?.nextPage()} className="epub-page-button epub-page-button-right" title="Next page">›</button>
      <div className="epub-view-controls ui-text">
        <button onClick={() => setEpubViewMode('2d')} title="2D 보기로 돌아가기 (선택, 하이라이트, 주석, 검색)">2D로</button>
        <button onClick={() => useCoachStore.getState().setIntakeOpen(true)} aria-pressed={coachEnabled} className={coachEnabled ? 'active' : ''} title="독서 코치 설정">코치</button>
      </div>
      <ReadingPaneFooter progress={progress} detail={pageLabel} />
      <ReadingSensesPanel />

      <CoachIntakeDialog />
      <CoachRail visibleText={visibleText} atChapterEnd={atChapterEnd} />
      {coach.hovered && (
        <CoachHoverCard key={coach.hovered.card.id} card={coach.hovered.card} deck={coach.hovered.deck} rect={coach.hovered.rect}
          cardRef={coach.cardRef} {...coach.hoverHandlers} />
      )}
    </div>
  )
}
