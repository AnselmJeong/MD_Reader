import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import epubModule, { type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import { TextSelectionMenu } from './TextSelectionMenu'
import { ReadingPaneFooter, ReadingPaneHeader, ReadingSensesPanel } from './ReadingChrome'
import { useDocumentStore, type EpubDocumentTab } from '../../store/useDocumentStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUIStore } from '../../store/useUIStore'
import type { EpubAnnotationKind, EpubAnnotationRecord, EpubAnnotationStyle } from '../../global'

interface EpubDocumentViewProps {
  tab: EpubDocumentTab
}

interface EpubSelection {
  cfiRange: string
  rect: DOMRect
  text: string
  contents: Contents
}

interface ActiveAnnotationMenu {
  cfiRange: string
  rect: DOMRect
}

interface TocItem {
  href: string
  label: string
  level: number
}

type SpreadMode = 'none' | 'always'

const EPUB_SPREAD_GAP = 44
const EPUB_ANNOTATION_CLASS = 'md-reader-epub-annotation'
const EPUB_FOCUS_STYLE_ID = 'md-reader-focus-style'
const EPUB_FOCUS_BLOCK_SELECTOR = 'p, blockquote, li'

const epubAnnotationStyles: Record<EpubAnnotationStyle, {
  kind: EpubAnnotationKind
  styles: Record<string, string>
}> = {
  yellow: {
    kind: 'highlight',
    styles: { fill: 'rgba(238, 192, 68, 0.45)', 'fill-opacity': '0.45', 'mix-blend-mode': 'multiply' }
  },
  green: {
    kind: 'highlight',
    styles: { fill: 'rgba(119, 184, 112, 0.42)', 'fill-opacity': '0.42', 'mix-blend-mode': 'multiply' }
  },
  blue: {
    kind: 'highlight',
    styles: { fill: 'rgba(93, 155, 214, 0.38)', 'fill-opacity': '0.38', 'mix-blend-mode': 'multiply' }
  },
  pink: {
    kind: 'highlight',
    styles: { fill: 'rgba(223, 118, 163, 0.36)', 'fill-opacity': '0.36', 'mix-blend-mode': 'multiply' }
  },
  'red-underline': {
    kind: 'underline',
    styles: { 'mix-blend-mode': 'multiply' }
  }
}

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

function applyEpubAnnotation(
  rendition: Rendition,
  annotation: Pick<EpubAnnotationRecord, 'cfiRange' | 'text' | 'style'>,
  onClick?: (event: Event, cfiRange: string) => void
) {
  const style = epubAnnotationStyles[annotation.style] ?? epubAnnotationStyles.yellow
  rendition.annotations.remove(annotation.cfiRange, 'highlight')
  rendition.annotations.remove(annotation.cfiRange, 'underline')
  const handleClick = onClick ? (event: Event) => onClick(event, annotation.cfiRange) : undefined

  if (style.kind === 'underline') {
    rendition.annotations.underline(
      annotation.cfiRange,
      { text: annotation.text, style: annotation.style },
      handleClick,
      EPUB_ANNOTATION_CLASS,
      style.styles
    )
    return
  }

  rendition.annotations.highlight(
    annotation.cfiRange,
    { text: annotation.text, style: annotation.style },
    handleClick,
    EPUB_ANNOTATION_CLASS,
    style.styles
  )
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
  const latestChapterHrefRef = useRef<string | null>(tab.currentChapterHref)
  const latestChapterLabelRef = useRef<string | null>(tab.currentChapterLabel)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const readerPageRef = useRef<HTMLElement>(null)
  const searchKeyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const focusKeyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false)
  const focusModeRef = useRef(false)
  const activeParagraphIndexRef = useRef(0)
  const resizeTimerRef = useRef<number | null>(null)
  const tocItemsRef = useRef<TocItem[]>([])
  const epubDragDepthRef = useRef(0)
  const epubDropCleanupRef = useRef<Array<() => void>>([])

  const {
    focusMode,
    showToC,
    showSearch,
    setShowSearch,
    toggleFocusMode,
    toggleToC
  } = useUIStore()
  const { theme, fontSize, lineHeight, contentWidth, readerFontFamily } = useSettingsStore()
  const { setDocument, updateEpubContent, updateEpubLocation } = useDocumentStore()

  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [title, setTitle] = useState(tab.content || tab.fileName.replace(/\.[^.]+$/, ''))
  const [sectionLabel, setSectionLabel] = useState('EPUB')
  const [progress, setProgress] = useState(0)
  const [selection, setSelection] = useState<EpubSelection | null>(null)
  const [activeAnnotationMenu, setActiveAnnotationMenu] = useState<ActiveAnnotationMenu | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [spreadMode, setSpreadMode] = useState<SpreadMode>('always')
  const [returnCfi, setReturnCfi] = useState<string | null>(null)
  const [isEpubDragging, setIsEpubDragging] = useState(false)

  const bookBuffer = useMemo(() => base64ToArrayBuffer(tab.epubBase64), [tab.epubBase64])

  const getFocusParagraphs = useCallback(() => {
    const rendition = renditionRef.current
    if (!rendition) return []
    return getRenditionContents(rendition).flatMap((contents) => (
      Array.from(contents.document.querySelectorAll<HTMLElement>(EPUB_FOCUS_BLOCK_SELECTOR))
        .filter((element) => {
          if (normalizeText(element.textContent ?? '').length === 0) return false
          if (element.matches('blockquote, li') && element.querySelector('p, blockquote, li')) return false
          return true
        })
    ))
  }, [])

  const updateEpubFocusAppearance = useCallback((enabled: boolean) => {
    const rendition = renditionRef.current
    if (!rendition) return

    getRenditionContents(rendition).forEach((contents) => {
      contents.document.body?.classList.toggle('md-reader-epub-focus', enabled)
      if (!enabled) {
        contents.document.querySelectorAll('.md-reader-epub-focus-active').forEach((element) => {
          element.classList.remove('md-reader-epub-focus-active')
        })
      }
    })
  }, [])

  const focusEpubReadingSurface = useCallback(() => {
    const body = renditionRef.current
      ? getRenditionContents(renditionRef.current)
        .map((contents) => contents.document.body)
        .find((candidate) => candidate != null)
      : null

    if (body) {
      body.tabIndex = -1
      body.focus({ preventScroll: true })
      return
    }
    readerPageRef.current?.focus({ preventScroll: true })
  }, [])

  const activateEpubParagraph = useCallback((index: number, shouldNavigate = true) => {
    const paragraphs = getFocusParagraphs()
    if (paragraphs.length === 0) return

    const nextIndex = Math.max(0, Math.min(paragraphs.length - 1, index))
    paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.classList.toggle('md-reader-epub-focus-active', paragraphIndex === nextIndex)
    })
    activeParagraphIndexRef.current = nextIndex
    updateEpubFocusAppearance(true)

    const target = paragraphs[nextIndex]
    if (shouldNavigate) {
      const rendition = renditionRef.current
      const targetContents = rendition
        ? getRenditionContents(rendition).find((contents) => contents.document === target.ownerDocument)
        : null
      const targetCfi = targetContents?.cfiFromNode(target, EPUB_ANNOTATION_CLASS)
      if (rendition && targetCfi) {
        void rendition.display(targetCfi).then(() => {
          requestAnimationFrame(() => activateEpubParagraph(activeParagraphIndexRef.current, false))
        })
        return
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }
  }, [getFocusParagraphs, updateEpubFocusAppearance])

  const handleToggleFocusMode = useCallback(() => {
    const willEnable = !focusModeRef.current
    focusModeRef.current = willEnable
    toggleFocusMode()
    if (willEnable) {
      requestAnimationFrame(focusEpubReadingSurface)
    }
  }, [focusEpubReadingSurface, toggleFocusMode])

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

  const showAnnotationMenu = useCallback((event: Event, cfiRange: string) => {
    event.preventDefault()
    event.stopPropagation()

    const target = event.target instanceof Element ? event.target : null
    const rect = target?.getBoundingClientRect()
    if (!rect) return

    setSelection(null)
    setActiveAnnotationMenu({
      cfiRange,
      rect: DOMRect.fromRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
    })
  }, [])

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
    const readerSurface = viewerRef.current?.closest('.reading-stage') ?? document.documentElement
    const styles = window.getComputedStyle(readerSurface)
    const foreground = styles.getPropertyValue('--reader-ink').trim()
      || styles.getPropertyValue('--color-on-surface').trim()
      || '#332c27'
    const muted = styles.getPropertyValue('--reader-ink-soft').trim()
      || styles.getPropertyValue('--color-on-surface-muted').trim()
      || '#766d64'
    const background = styles.getPropertyValue('--reader-paper').trim()
      || styles.getPropertyValue('--color-surface').trim()
      || '#fbf8f1'
    const accent = styles.getPropertyValue('--reader-accent').trim()
      || styles.getPropertyValue('--color-accent').trim()
      || '#914c35'
    const escapedFontFamily = readerFontFamily.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    const fontFamily = readerFontFamily
      ? `"${escapedFontFamily}", "Noto Serif KR", Georgia, serif`
      : 'Newsreader, "Noto Serif KR", Georgia, serif'
    const bodyPadding = spreadMode === 'always' ? '1.25rem 1.75rem' : '1.25rem 3rem'
    rendition.themes.default({
      html: {
        background,
        margin: '0',
        padding: '0',
        '--md-reader-focus-accent': accent,
      },
      body: {
        color: foreground,
        background,
        'font-family': fontFamily,
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
      [`.${EPUB_ANNOTATION_CLASS}`]: {
        fill: 'rgba(238, 192, 68, 0.45)',
        'fill-opacity': '0.45',
        'mix-blend-mode': 'multiply',
      }
    })
  }, [fontSize, lineHeight, readerFontFamily, spreadMode, theme])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    viewer.replaceChildren()
    currentCfiRef.current = tab.currentLocation
    latestChapterHrefRef.current = tab.currentChapterHref
    latestChapterLabelRef.current = tab.currentChapterLabel
    latestTextRef.current = ''
    setSelection(null)
    setActiveAnnotationMenu(null)
    setReturnCfi(null)
    setIsEpubDragging(false)
    setProgress(tab.lastProgress ?? 0)
    setTocItems([])
    tocItemsRef.current = []

    const book = createEpubBook(bookBuffer)
    const rendition = book.renderTo(viewer, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: spreadMode,
      minSpreadWidth: 0,
      gap: spreadMode === 'always' ? EPUB_SPREAD_GAP : 0,
      ignoreClass: EPUB_ANNOTATION_CLASS,
      allowScriptedContent: false
    } as Parameters<Book['renderTo']>[1] & { gap: number })

    bookRef.current = book
    renditionRef.current = rendition
    applyTheme(rendition)

    rendition.hooks.content.register((contents: Contents) => {
      let focusStyle = contents.document.getElementById(EPUB_FOCUS_STYLE_ID) as HTMLStyleElement | null
      if (!focusStyle) {
        focusStyle = contents.document.createElement('style')
        focusStyle.id = EPUB_FOCUS_STYLE_ID
        focusStyle.textContent = `
          body.md-reader-epub-focus :is(p, blockquote, li) {
            opacity: 0.48;
            transition: opacity 220ms ease, background 220ms ease, transform 240ms cubic-bezier(0.2, 0, 0, 1), box-shadow 220ms ease;
          }
          body.md-reader-epub-focus :is(p, blockquote, li).md-reader-epub-focus-active {
            opacity: 1;
            border-radius: 3px;
            background: color-mix(in oklch, var(--md-reader-focus-accent) 6%, transparent);
            box-shadow: -14px 0 0 -11px var(--md-reader-focus-accent);
            transform: translateX(4px);
          }
          @media (prefers-reduced-motion: reduce) {
            body.md-reader-epub-focus :is(p, blockquote, li) { transition: none; }
          }
        `
        contents.document.head.appendChild(focusStyle)
      }
      if (contents.document.body) {
        contents.document.body.tabIndex = -1
        contents.document.body.classList.toggle('md-reader-epub-focus', focusModeRef.current)
      }

      contents.on('linkClicked', () => {
        const cfi = currentCfiRef.current ?? rendition.location?.start?.cfi ?? null
        if (cfi) setReturnCfi(cfi)
      })

      const handleContentMouseDown = () => {
        setSelection(null)
        setActiveAnnotationMenu(null)
      }

      const handleContentKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
          searchKeyHandlerRef.current(event)
          return
        }

        if (focusKeyHandlerRef.current(event)) return

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
      contents.document.addEventListener('keydown', handleContentKeyDown, true)
      contents.document.addEventListener('dragenter', handleDragEnter)
      contents.document.addEventListener('dragover', handleDragOver)
      contents.document.addEventListener('dragleave', handleDragLeave)
      contents.document.addEventListener('drop', handleDrop)

      epubDropCleanupRef.current.push(() => {
        contents.document.removeEventListener('mousedown', handleContentMouseDown)
        contents.document.removeEventListener('keydown', handleContentKeyDown, true)
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
      if (focusModeRef.current) {
        requestAnimationFrame(() => {
          activateEpubParagraph(activeParagraphIndexRef.current, false)
          focusEpubReadingSurface()
        })
      }
    })

    rendition.on('relocated', (location: Location) => {
      const percentage = location.start?.percentage
      const nextProgress = typeof percentage === 'number' && Number.isFinite(percentage)
        ? Math.max(0, Math.min(1, percentage))
        : null
      if (typeof percentage === 'number' && Number.isFinite(percentage)) {
        setProgress(nextProgress ?? 0)
      }
      const cfi = location.start?.cfi ?? null
      const chapterHref = location.start?.href?.split('#')[0] ?? null
      const chapterLabel = findCurrentTocLabel(tocItemsRef.current, location.start?.href)
      currentCfiRef.current = cfi
      latestChapterHrefRef.current = chapterHref
      latestChapterLabelRef.current = chapterLabel
      updateEpubLocation(tab.id, cfi, chapterHref, chapterLabel)
      if (cfi) {
        void window.api.epub.saveProgress({
          documentId: tab.documentHash,
          fileName: tab.fileName,
          filePath: tab.filePath,
          cfi,
          chapterHref,
          chapterLabel,
          progress: nextProgress
        }).catch((error) => {
          console.error('Failed to save EPUB reading progress:', error)
        })
      }
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
      setActiveAnnotationMenu(null)
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
    void window.api.epub.listAnnotations({
      documentId: tab.documentHash,
      fileName: tab.fileName
    }).then((annotations) => {
      annotations.forEach((annotation) => applyEpubAnnotation(rendition, annotation, showAnnotationMenu))
    }).catch((error) => {
      console.error('Failed to load EPUB annotations:', error)
    })

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
  }, [
    bookBuffer,
    openDroppedFiles,
    spreadMode,
    tab.documentHash,
    tab.fileName,
    tab.filePath,
    tab.id,
    tab.lastProgress,
    updateEpubLocation,
    updateVisibleText,
    showAnnotationMenu,
    activateEpubParagraph,
    focusEpubReadingSurface
  ])

  useEffect(() => {
    const rendition = renditionRef.current
    if (rendition) applyTheme(rendition)
  }, [applyTheme])

  useEffect(() => {
    focusModeRef.current = focusMode
    updateEpubFocusAppearance(focusMode)
    if (!focusMode) return

    const paragraphs = getFocusParagraphs()
    const visibleIndex = paragraphs.findIndex((paragraph) => {
      const rect = paragraph.getBoundingClientRect()
      const view = paragraph.ownerDocument.defaultView
      return Boolean(
        view
        && rect.right > 0
        && rect.left < view.innerWidth
        && rect.bottom > 0
        && rect.top < view.innerHeight
      )
    })
    activateEpubParagraph(visibleIndex >= 0 ? visibleIndex : activeParagraphIndexRef.current, false)
  }, [
    activateEpubParagraph,
    focusMode,
    getFocusParagraphs,
    updateEpubFocusAppearance
  ])

  useEffect(() => {
    focusKeyHandlerRef.current = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.metaKey
        || event.ctrlKey
        || event.altKey
        || target?.closest('input, textarea, select, [contenteditable="true"]')
      ) return false

      const key = event.code === 'KeyF'
        ? 'f'
        : event.code === 'KeyJ'
          ? 'j'
          : event.code === 'KeyK'
            ? 'k'
            : event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        event.stopPropagation()
        handleToggleFocusMode()
        return true
      }
      if (!focusModeRef.current || (key !== 'j' && key !== 'k')) return false

      event.preventDefault()
      event.stopPropagation()
      activateEpubParagraph(activeParagraphIndexRef.current + (key === 'j' ? 1 : -1))
      return true
    }
  }, [activateEpubParagraph, handleToggleFocusMode])

  useEffect(() => {
    const handleFocusKeyDown = (event: KeyboardEvent) => {
      focusKeyHandlerRef.current(event)
    }
    window.addEventListener('keydown', handleFocusKeyDown, true)
    return () => window.removeEventListener('keydown', handleFocusKeyDown, true)
  }, [])

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
  }, [contentWidth, resizeRenditionToSurface, scheduleRenditionResize, showToC])

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

  const handleHighlightSelection = useCallback((style: EpubAnnotationStyle) => {
    if (!selection) return
    const rendition = renditionRef.current
    if (!rendition) return
    const styleDefinition = epubAnnotationStyles[style] ?? epubAnnotationStyles.yellow

    applyEpubAnnotation(rendition, {
      cfiRange: selection.cfiRange,
      text: selection.text,
      style
    }, showAnnotationMenu)

    void window.api.epub.saveAnnotation({
      documentId: tab.documentHash,
      fileName: tab.fileName,
      filePath: tab.filePath,
      cfiRange: selection.cfiRange,
      text: selection.text,
      style,
      kind: styleDefinition.kind,
      chapterHref: latestChapterHrefRef.current,
      chapterLabel: latestChapterLabelRef.current
    }).catch((error) => {
      console.error('Failed to save EPUB annotation:', error)
    })
  }, [selection, tab.documentHash, tab.fileName, tab.filePath, showAnnotationMenu])

  const handleDeleteAnnotation = useCallback(() => {
    if (!activeAnnotationMenu) return
    const rendition = renditionRef.current
    const { cfiRange } = activeAnnotationMenu

    rendition?.annotations.remove(cfiRange, 'highlight')
    rendition?.annotations.remove(cfiRange, 'underline')
    setActiveAnnotationMenu(null)

    void window.api.epub.deleteAnnotation({
      documentId: tab.documentHash,
      cfiRange
    }).catch((error) => {
      console.error('Failed to delete EPUB annotation:', error)
    })
  }, [activeAnnotationMenu, tab.documentHash])

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
  const normalizedPageWidth = Math.max(0, Math.min(1, (contentWidth - 52) / 30))
  const pageWidthPercentage = spreadMode === 'always'
    ? 75 + normalizedPageWidth * 23
    : 58 + normalizedPageWidth * 28

  return (
    <div className={`reading-stage epub-reading-stage ${focusMode ? 'focus-mode' : ''}`}>
      <ReadingPaneHeader
        label={normalizedSectionLabel}
        progress={progress}
        showToC={showToC}
        onToggleFocusMode={handleToggleFocusMode}
        onToggleToC={toggleToC}
      />

      {showToC && (
        <div className="reading-toc-panel">
          <EpubTableOfContents items={tocItems} onNavigate={handleNavigate} />
        </div>
      )}

      {showSearch && (
        <div
          data-search-panel="true"
          className="absolute right-4 top-[64px] z-30 flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-2 py-1.5 shadow-md"
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

      <div className="reading-viewport epub-reading-viewport">
        <article
          ref={readerPageRef}
          className={`reader-page-canvas epub-reader-page epub-reader-page-${spreadMode}`}
          style={{ width: `${pageWidthPercentage}%` }}
          tabIndex={-1}
        >
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
        </article>
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
      <ReadingPaneFooter progress={progress} detail="EPUB" />
      <ReadingSensesPanel />

      {activeAnnotationMenu && (
        <div
          data-selection-menu="true"
          onMouseDown={(event) => event.preventDefault()}
          className="epub-annotation-menu selection-floating-menu fixed z-50 flex items-center rounded-lg border px-1 py-1 ui-text"
          style={{
            top: `${Math.min(window.innerHeight - 48, activeAnnotationMenu.rect.bottom + 10)}px`,
            left: `${Math.min(Math.max(activeAnnotationMenu.rect.left + activeAnnotationMenu.rect.width / 2, 84), window.innerWidth - 84)}px`,
            transform: 'translateX(-50%)',
            background: 'var(--selection-menu-bg)',
            borderColor: 'var(--selection-menu-hair)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <button
            onClick={handleDeleteAnnotation}
            className="selection-menu-item text-[rgba(255,130,120,0.95)] hover:text-[rgba(255,165,155,1)]"
            title="Delete highlight"
          >
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
              <path className="icon-stroke" d="M3.5 4.5h9M6 4.5v-1h4v1M5 6.5l.4 6h5.2l.4-6M7 7.5v3.5M9 7.5v3.5" />
            </svg>
            Delete
          </button>
        </div>
      )}

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
