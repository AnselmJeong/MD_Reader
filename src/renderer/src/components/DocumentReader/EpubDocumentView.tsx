import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import epubModule, { type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import { TextSelectionMenu } from './TextSelectionMenu'
import { ReadingProgress } from './ReadingProgress'
import { ContentsRailButton } from './ContentsRailButton'
import { useDocumentStore, type EpubDocumentTab } from '../../store/useDocumentStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUIStore } from '../../store/useUIStore'

interface EpubDocumentViewProps {
  tab: EpubDocumentTab
}

interface EpubSelection {
  cfiRange: string
  rect: DOMRect
  text: string
  contents: Contents
}

interface TocItem {
  href: string
  label: string
  level: number
}

type SpreadMode = 'none' | 'always'

const EPUB_SPREAD_GAP = 44

const createEpubBook = (
  ((epubModule as unknown as { default?: unknown }).default ?? epubModule) as (urlOrData: string | ArrayBuffer) => Book
)

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function flattenToc(items: NavItem[], level = 1): TocItem[] {
  return items.flatMap((item) => [
    { href: item.href, label: item.label || 'Untitled', level },
    ...flattenToc(item.subitems ?? [], level + 1)
  ])
}

function getRenditionContents(rendition: Rendition): Contents[] {
  const contents = rendition.getContents() as Contents | Contents[] | null
  if (!contents) return []
  return Array.isArray(contents) ? contents : [contents]
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractVisibleText(rendition: Rendition): string {
  return normalizeText(
    getRenditionContents(rendition)
      .map((contents) => contents.document?.body?.innerText ?? '')
      .join('\n\n')
  )
}

function getSelectionClientRect(contents: Contents): DOMRect | null {
  const selection = contents.window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
  const sourceRect = rects[0] ?? range.getBoundingClientRect()
  if (!sourceRect || sourceRect.width === 0 || sourceRect.height === 0) return null

  const frameElement = contents.window.frameElement as HTMLElement | null
  const frameRect = frameElement?.getBoundingClientRect()
  const offsetLeft = frameRect?.left ?? 0
  const offsetTop = frameRect?.top ?? 0

  return DOMRect.fromRect({
    x: offsetLeft + sourceRect.left,
    y: offsetTop + sourceRect.top,
    width: sourceRect.width,
    height: sourceRect.height
  })
}

function findCurrentTocLabel(tocItems: TocItem[], href: string | undefined) {
  if (!href) return null
  const normalizedHref = href.split('#')[0]
  return tocItems.find((item) => item.href === href || item.href.split('#')[0] === normalizedHref)?.label ?? null
}

function isSupportedDocumentFile(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.epub')
}

function EpubTableOfContents({
  items,
  onNavigate
}: {
  items: TocItem[]
  onNavigate: (href: string) => void
}) {
  const { toggleToC } = useUIStore()

  return (
    <div className="h-full w-72 shrink-0 overflow-y-auto border-r border-border bg-surface-alt">
      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface-alt px-4 py-3">
        <span className="small-caps text-on-surface">Contents</span>
        <button
          onClick={toggleToC}
          className="rounded px-1 text-on-surface-muted transition-colors hover:bg-[var(--ink-3)] hover:text-on-surface"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
            <path className="icon-stroke" d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="p-3">
        {items.length > 0 ? items.map((item) => (
          <button
            key={`${item.href}-${item.label}`}
            onClick={() => onNavigate(item.href)}
            className="w-full truncate rounded-md px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--ink-3)] ui-text"
            style={{ paddingLeft: `${Math.min(item.level - 1, 4) * 16 + 12}px` }}
            title={item.label}
          >
            <span className={item.level === 1 ? 'font-semibold text-on-surface' : 'text-on-surface-muted'}>
              {item.label}
            </span>
          </button>
        )) : (
          <p className="px-3 py-2 text-[12px] text-on-surface-muted">No EPUB contents found.</p>
        )}
      </div>
    </div>
  )
}

export function EpubDocumentView({ tab }: EpubDocumentViewProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const currentCfiRef = useRef<string | null>(tab.currentLocation)
  const latestTextRef = useRef('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchKeyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const resizeTimerRef = useRef<number | null>(null)
  const tocItemsRef = useRef<TocItem[]>([])
  const epubDragDepthRef = useRef(0)
  const epubDropCleanupRef = useRef<Array<() => void>>([])

  const { showToC, showSearch, setShowSearch, toggleToC } = useUIStore()
  const { fontSize, lineHeight } = useSettingsStore()
  const { setDocument, updateEpubContent, updateEpubLocation } = useDocumentStore()

  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [title, setTitle] = useState(tab.content || tab.fileName.replace(/\.[^.]+$/, ''))
  const [sectionLabel, setSectionLabel] = useState('EPUB')
  const [progress, setProgress] = useState(0)
  const [selection, setSelection] = useState<EpubSelection | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [spreadMode, setSpreadMode] = useState<SpreadMode>('always')
  const [returnCfi, setReturnCfi] = useState<string | null>(null)
  const [isEpubDragging, setIsEpubDragging] = useState(false)

  const bookBuffer = useMemo(() => base64ToArrayBuffer(tab.epubBase64), [tab.epubBase64])

  const updateVisibleText = useCallback((rendition: Rendition) => {
    const text = extractVisibleText(rendition)
    if (text && text !== latestTextRef.current) {
      latestTextRef.current = text
      updateEpubContent(tab.id, text)
    }
  }, [tab.id, updateEpubContent])

  const openDroppedFiles = useCallback(async (files: FileList | null | undefined) => {
    if (!files?.length) return

    for (const file of Array.from(files)) {
      if (!isSupportedDocumentFile(file)) continue

      const filePath = window.api.utils.getPathForFile(file)
      if (!filePath) continue

      const document = await window.api.file.read(filePath)
      setDocument(document)
    }
  }, [setDocument])

  const resizeRenditionToSurface = useCallback(() => {
    const viewer = viewerRef.current
    const rendition = renditionRef.current
    if (!viewer || !rendition) return

    const rect = viewer.getBoundingClientRect()
    const width = Math.floor(rect.width)
    const height = Math.floor(rect.height)
    if (width <= 0 || height <= 0) return

    const cfi = currentCfiRef.current ?? rendition.location?.start?.cfi
    ;(rendition.resize as unknown as (width: number, height: number, epubcfi?: string) => void)(width, height, cfi ?? undefined)
  }, [])

  const scheduleRenditionResize = useCallback((delay = 0) => {
    if (resizeTimerRef.current != null) {
      window.clearTimeout(resizeTimerRef.current)
    }

    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null
      requestAnimationFrame(resizeRenditionToSurface)
    }, delay)
  }, [resizeRenditionToSurface])

  const applyTheme = useCallback((rendition: Rendition) => {
    const styles = window.getComputedStyle(document.documentElement)
    const foreground = styles.getPropertyValue('--color-on-surface').trim() || '#191714'
    const muted = styles.getPropertyValue('--color-on-surface-muted').trim() || '#6f6a61'
    const background = styles.getPropertyValue('--color-surface').trim() || '#fbfaf7'
    const bodyPadding = spreadMode === 'always' ? '1.25rem 1.75rem' : '1.25rem 3rem'
    rendition.themes.default({
      html: {
        background,
        margin: '0',
        padding: '0',
      },
      body: {
        color: foreground,
        background,
        'font-size': `${fontSize}px`,
        'line-height': String(lineHeight),
        margin: '0',
        'max-width': 'none',
        width: '100%',
        'box-sizing': 'border-box',
        padding: bodyPadding,
      },
      '*': {
        'box-sizing': 'border-box',
      },
      p: {
        'line-height': String(lineHeight),
      },
      a: {
        color: foreground,
        'text-decoration-color': muted,
      },
      '::selection': {
        background: 'rgba(220, 176, 73, 0.28)',
      },
      '.epubjs-hl': {
        fill: 'rgba(238, 192, 68, 0.45)',
        'fill-opacity': '0.45',
        'mix-blend-mode': 'multiply',
      }
    })
  }, [fontSize, lineHeight, spreadMode])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    viewer.replaceChildren()
    currentCfiRef.current = tab.currentLocation
    latestTextRef.current = ''
    setSelection(null)
    setReturnCfi(null)
    setIsEpubDragging(false)
    setProgress(0)
    setTocItems([])
    tocItemsRef.current = []

    const book = createEpubBook(bookBuffer)
    const rendition = book.renderTo(viewer, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      layout: 'paginated',
      spread: spreadMode,
      minSpreadWidth: 760,
      gap: spreadMode === 'always' ? EPUB_SPREAD_GAP : 0,
      ignoreClass: 'epubjs-hl',
      allowScriptedContent: false
    } as Parameters<Book['renderTo']>[1] & { gap: number })

    bookRef.current = book
    renditionRef.current = rendition
    applyTheme(rendition)

    rendition.hooks.content.register((contents: Contents) => {
      contents.on('linkClicked', () => {
        const cfi = currentCfiRef.current ?? rendition.location?.start?.cfi ?? null
        if (cfi) setReturnCfi(cfi)
      })

      const handleContentMouseDown = () => {
        setSelection(null)
      }

      const handleContentKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
          searchKeyHandlerRef.current(event)
          return
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          void rendition.prev()
          return
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          void rendition.next()
          return
        }

        searchKeyHandlerRef.current(event)
      }

      const handleDragEnter = (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        epubDragDepthRef.current += 1
        setIsEpubDragging(true)
      }

      const handleDragOver = (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
      }

      const handleDragLeave = (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        epubDragDepthRef.current = Math.max(0, epubDragDepthRef.current - 1)
        if (epubDragDepthRef.current === 0) {
          setIsEpubDragging(false)
        }
      }

      const handleDrop = (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        epubDragDepthRef.current = 0
        setIsEpubDragging(false)
        void openDroppedFiles(event.dataTransfer?.files)
      }

      contents.document.addEventListener('mousedown', handleContentMouseDown)
      contents.document.addEventListener('keydown', handleContentKeyDown)
      contents.document.addEventListener('dragenter', handleDragEnter)
      contents.document.addEventListener('dragover', handleDragOver)
      contents.document.addEventListener('dragleave', handleDragLeave)
      contents.document.addEventListener('drop', handleDrop)

      epubDropCleanupRef.current.push(() => {
        contents.document.removeEventListener('mousedown', handleContentMouseDown)
        contents.document.removeEventListener('keydown', handleContentKeyDown)
        contents.document.removeEventListener('dragenter', handleDragEnter)
        contents.document.removeEventListener('dragover', handleDragOver)
        contents.document.removeEventListener('dragleave', handleDragLeave)
        contents.document.removeEventListener('drop', handleDrop)
      })
    })

    book.loaded.metadata.then((metadata) => {
      const metadataTitle = typeof metadata.title === 'string' ? metadata.title.trim() : ''
      if (metadataTitle) setTitle(metadataTitle)
    }).catch((error) => {
      console.error('Failed to read EPUB metadata:', error)
    })

    book.loaded.navigation.then((navigation) => {
      const nextItems = flattenToc(navigation.toc ?? [])
      tocItemsRef.current = nextItems
      setTocItems(nextItems)
    }).catch((error) => {
      console.error('Failed to read EPUB navigation:', error)
    })

    rendition.on('rendered', () => {
      updateVisibleText(rendition)
    })

    rendition.on('relocated', (location: Location) => {
      const percentage = location.start?.percentage
      if (typeof percentage === 'number' && Number.isFinite(percentage)) {
        setProgress(Math.max(0, Math.min(100, percentage * 100)))
      }
      const cfi = location.start?.cfi ?? null
      const chapterHref = location.start?.href?.split('#')[0] ?? null
      const chapterLabel = findCurrentTocLabel(tocItemsRef.current, location.start?.href)
      currentCfiRef.current = cfi
      updateEpubLocation(tab.id, cfi, chapterHref, chapterLabel)
      setSectionLabel((current) => chapterLabel ?? current)
      requestAnimationFrame(() => updateVisibleText(rendition))
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        void rendition.prev()
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        void rendition.next()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    const handleOuterMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-selection-menu="true"]') || target?.closest('[data-search-panel="true"]')) {
        return
      }
      setSelection(null)
    }
    document.addEventListener('mousedown', handleOuterMouseDown)

    rendition.on('selected', async (cfiRange: string, contents: Contents) => {
      const rect = getSelectionClientRect(contents)
      if (!rect) return

      let selectedText = normalizeText(contents.window.getSelection()?.toString() ?? '')
      if (!selectedText) {
        try {
          const range = await book.getRange(cfiRange)
          selectedText = normalizeText(range?.toString() ?? '')
        } catch (error) {
          console.error('Failed to resolve EPUB selection text:', error)
        }
      }

      if (selectedText) {
        setSelection({ cfiRange, contents, rect, text: selectedText })
      }
    })

    const initialLocation = tab.currentLocation
    void rendition.display(initialLocation ?? undefined).then(() => {
      updateVisibleText(rendition)
    }).catch((error) => {
      console.error('Failed to display EPUB:', error)
    })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleOuterMouseDown)
      epubDropCleanupRef.current.forEach((cleanup) => cleanup())
      epubDropCleanupRef.current = []
      epubDragDepthRef.current = 0
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
      rendition.destroy()
      book.destroy()
      renditionRef.current = null
      bookRef.current = null
    }
  }, [bookBuffer, openDroppedFiles, spreadMode, tab.id, updateEpubLocation, updateVisibleText])

  useEffect(() => {
    const rendition = renditionRef.current
    if (rendition) applyTheme(rendition)
  }, [applyTheme])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const resizeObserver = new ResizeObserver(() => {
      scheduleRenditionResize(40)
    })
    resizeObserver.observe(viewer)

    return () => resizeObserver.disconnect()
  }, [scheduleRenditionResize])

  useEffect(() => {
    requestAnimationFrame(resizeRenditionToSurface)
    scheduleRenditionResize(120)
  }, [resizeRenditionToSurface, scheduleRenditionResize, showToC])

  const handleNavigate = useCallback((href: string) => {
    setReturnCfi(null)
    void renditionRef.current?.display(href)
  }, [])

  const returnFromLink = useCallback(() => {
    if (!returnCfi) return
    const target = returnCfi
    setReturnCfi(null)
    void renditionRef.current?.display(target)
  }, [returnCfi])

  const goToPreviousPage = useCallback(() => {
    void renditionRef.current?.prev()
  }, [])

  const goToNextPage = useCallback(() => {
    void renditionRef.current?.next()
  }, [])

  const clearSelection = useCallback(() => {
    selection?.contents.window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [selection])

  const handleHighlightSelection = useCallback(() => {
    if (!selection) return
    renditionRef.current?.annotations.highlight(
      selection.cfiRange,
      { text: selection.text },
      undefined,
      'epubjs-hl',
      { fill: 'rgba(238, 192, 68, 0.45)', 'fill-opacity': '0.45' }
    )
  }, [selection])

  const runSearch = useCallback((backward = false) => {
    if (!searchQuery.trim()) return
    const rendition = renditionRef.current
    if (!rendition) return
    for (const contents of getRenditionContents(rendition)) {
      const found = (contents.window as Window & {
        find?: (...args: [string, boolean, boolean, boolean, boolean, boolean, boolean]) => boolean
      }).find?.(searchQuery, false, backward, true, false, false, false)
      if (found) break
    }
  }, [searchQuery])

  useEffect(() => {
    if (!showSearch) return
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [showSearch])

  useEffect(() => {
    searchKeyHandlerRef.current = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (mod && key === 'f') {
        event.preventDefault()
        event.stopPropagation()
        setShowSearch(true)
        requestAnimationFrame(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        })
        return
      }

      if (showSearch && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setShowSearch(false)
        searchInputRef.current?.blur()
        return
      }

      if (showSearch && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        runSearch(event.shiftKey)
      }
    }
  }, [runSearch, setShowSearch, showSearch])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      searchKeyHandlerRef.current(event)
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [])

  const normalizedSectionLabel = sectionLabel === 'EPUB' ? title : sectionLabel

  return (
    <div className="relative flex h-full">
      <ReadingProgress progress={progress} />

      {showToC && <EpubTableOfContents items={tocItems} onNavigate={handleNavigate} />}

      {showSearch && (
        <div
          data-search-panel="true"
          className="absolute top-3 right-4 z-30 flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-2 py-1.5 shadow-md"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runSearch(event.shiftKey)
              }
            }}
            className="w-56 rounded border border-border bg-surface px-2 py-1 text-xs text-on-surface outline-none focus:border-accent"
            placeholder="Find in current EPUB section..."
            spellCheck={false}
          />
          <span className="min-w-14 text-center text-xs text-on-surface-muted">EPUB</span>
          <button
            onClick={() => runSearch(true)}
            className="rounded px-1.5 py-1 text-xs text-on-surface-muted hover:bg-surface"
            title="Previous match"
          >
            ↑
          </button>
          <button
            onClick={() => runSearch(false)}
            className="rounded px-1.5 py-1 text-xs text-on-surface-muted hover:bg-surface"
            title="Next match"
          >
            ↓
          </button>
          <button
            onClick={() => setShowSearch(false)}
            className="rounded px-1.5 py-1 text-xs text-on-surface-muted hover:bg-surface"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {isEpubDragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-surface/85 backdrop-blur-sm">
          <div className="rounded-lg border border-dashed border-accent px-12 py-10 text-center">
            <div className="small-caps mb-4 text-accent">Drop Document</div>
            <h2 className="font-serif text-3xl text-on-surface">Open this document</h2>
            <p className="mt-2 text-sm text-on-surface-muted">Release to begin reading.</p>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex h-full min-h-0">
          <aside className="sticky top-0 hidden h-[calc(100vh-98px)] w-14 shrink-0 border-r border-border bg-surface-alt md:block">
            <ContentsRailButton active={showToC} onClick={toggleToC} />
            <div className="reader-rail-label small-caps text-on-surface-muted">
              EPUB · {normalizedSectionLabel}
            </div>
            <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-on-surface-muted/35" />
              <span className="h-1.5 w-1.5 rounded-full bg-on-surface-muted/35" />
              <span className="h-4 w-px bg-accent" />
              <span className="h-1.5 w-1.5 rounded-full bg-on-surface-muted/35" />
              <span className="h-1.5 w-1.5 rounded-full bg-on-surface-muted/35" />
            </div>
          </aside>
          <div className="epub-document-body flex min-w-0 flex-1 flex-col">
            <div className={`epub-viewer-shell epub-viewer-shell-${spreadMode} min-h-0 flex-1`}>
              <div ref={viewerRef as RefObject<HTMLDivElement>} className="epub-render-surface" />
              {returnCfi && (
                <button
                  onClick={returnFromLink}
                  className="epub-return-button ui-text"
                  title="Return to previous reading position"
                >
                  <span aria-hidden="true">↩</span>
                  <span>Back</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={goToPreviousPage}
        className="epub-page-button epub-page-button-left"
        title="Previous page"
      >
        ‹
      </button>
      <button
        onClick={goToNextPage}
        className="epub-page-button epub-page-button-right"
        title="Next page"
      >
        ›
      </button>
      <div className="epub-view-controls ui-text">
        <button
          onClick={() => setSpreadMode('none')}
          className={spreadMode === 'none' ? 'active' : ''}
          title="Single page view"
        >
          1p
        </button>
        <button
          onClick={() => setSpreadMode('always')}
          className={spreadMode === 'always' ? 'active' : ''}
          title="Two page view"
        >
          2p
        </button>
      </div>

      {selection && (
        <TextSelectionMenu
          rect={selection.rect}
          selectedText={selection.text}
          onHighlight={handleHighlightSelection}
          onClose={clearSelection}
        />
      )}
    </div>
  )
}
