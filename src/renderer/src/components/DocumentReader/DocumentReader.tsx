import { metadataText, readDocumentMetadata } from '../../../../shared/document-metadata'
import { extractQuartoHeadings } from './utils/headings'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MetadataCard } from './MetadataCard'
import { TableOfContents } from './TableOfContents'
import { TextSelectionMenu } from './TextSelectionMenu'
import { EpubDocumentView } from './EpubDocumentView'
import { LinkTooltip } from './LinkTooltip'
import { ReadingPaneFooter, ReadingPaneHeader, ReadingSensesPanel } from './ReadingChrome'
import { useDocumentSearch } from './hooks/useDocumentSearch'
import { useParagraphFocus } from './hooks/useParagraphFocus'
import { useTextSelectionHighlight } from './hooks/useTextSelectionHighlight'
import { useLinkTooltip } from './hooks/useLinkTooltip'
import { useDocumentStore, type MarkdownDocumentTab } from '../../store/useDocumentStore'
import { useUIStore } from '../../store/useUIStore'
import { useTtsStore } from '../../store/useTtsStore'
import { clearTtsMarks, markSpokenText } from './utils/ttsDom'

function getPrimaryHeading(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.replace(/[*_`]/g, '').trim() || 'Document'
}

function stripPrimaryHeading(content: string): string {
  return content.replace(/^#\s+.+\n+/, '')
}

function MarkdownDocumentView({ tab }: { tab: MarkdownDocumentTab }) {
  const { updateContent } = useDocumentStore()
  const { focusMode, showToC, showSearch, setShowSearch, toggleFocusMode, toggleToC } = useUIStore()
  const { activeUtteranceId, state: ttsState, utterances } = useTtsStore()
  const { content, bibContent, fileName, wordCount, readingTime } = tab
  const scrollRef = useRef<HTMLDivElement>(null)
  const documentBodyRef = useRef<HTMLDivElement>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const { hoveredLink, tooltipRef } = useLinkTooltip({ bibContent, content, documentKey: tab.id, scrollRef })
  const {
    activeSearchIndex,
    goToNextMatch,
    goToPreviousMatch,
    searchInputRef,
    searchQuery,
    searchResultCount,
    setSearchQuery
  } = useDocumentSearch({
    content,
    rootRef: documentBodyRef,
    scrollRef,
    showSearch,
    setShowSearch
  })
  const { clearSelection, handleHighlightSelection, selectedText, selectionRect } = useTextSelectionHighlight({
    content,
    rootRef: documentBodyRef,
    updateContent
  })
  const quarto = /\.qmd$/i.test(tab.filePath)
  const sectionLabel = useMemo(() => quarto
    ? metadataText(readDocumentMetadata(content).title) || extractQuartoHeadings(content)[0]?.text || fileName
    : getPrimaryHeading(content), [content, quarto, fileName])
  const renderedContent = quarto ? content : stripPrimaryHeading(content)
  useParagraphFocus({
    enabled: focusMode,
    rootRef: documentBodyRef,
    scrollRef,
    contentKey: content
  })

  const handleToggleFocusMode = useCallback(() => {
    const willEnable = !focusMode
    toggleFocusMode()
    if (willEnable) {
      requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }))
    }
  }, [focusMode, toggleFocusMode])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const updateProgress = () => {
      const scrollable = container.scrollHeight - container.clientHeight
      setScrollProgress(scrollable > 0 ? Math.max(0, Math.min(1, container.scrollTop / scrollable)) : 1)
    }
    updateProgress()
    container.addEventListener('scroll', updateProgress, { passive: true })
    const resizeObserver = new ResizeObserver(updateProgress)
    resizeObserver.observe(container)
    return () => {
      container.removeEventListener('scroll', updateProgress)
      resizeObserver.disconnect()
    }
  }, [content])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || target?.closest('input, textarea, select, [contenteditable="true"]')
      ) return
      if (event.code !== 'KeyF' && event.key.toLowerCase() !== 'f') return

      event.preventDefault()
      handleToggleFocusMode()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleToggleFocusMode])

  useEffect(() => {
    const root = documentBodyRef.current
    if (!root) return

    if (!activeUtteranceId || ttsState === 'stopped' || ttsState === 'ended' || ttsState === 'idle') {
      clearTtsMarks(root)
      return
    }

    const utterance = utterances.find((item) => item.id === activeUtteranceId)
    if (!utterance) return
    markSpokenText(root, scrollRef.current, utterance.text)
  }, [activeUtteranceId, ttsState, utterances])

  if (!content) return null

  return (
    <div className={`reading-stage ${focusMode ? 'focus-mode' : ''}`}>
      <ReadingPaneHeader
        label={sectionLabel}
        progress={scrollProgress}
        showToC={showToC}
        onToggleFocusMode={handleToggleFocusMode}
        onToggleToC={toggleToC}
      />

      {/* Table of Contents overlay */}
      {showToC && (
        <div className="reading-toc-panel">
          <TableOfContents quarto={quarto} content={content} scrollContainer={scrollRef as React.RefObject<HTMLDivElement>} />
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
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56 rounded border border-border bg-surface px-2 py-1 text-xs text-on-surface outline-none focus:border-accent"
            placeholder="Find in document..."
            spellCheck={false}
          />
          <span className="min-w-14 text-center text-xs text-on-surface-muted">
            {searchResultCount > 0 ? `${activeSearchIndex + 1} / ${searchResultCount}` : '0 / 0'}
          </span>
          <button
            onClick={goToPreviousMatch}
            disabled={searchResultCount === 0}
            className="rounded px-1.5 py-1 text-xs text-on-surface-muted hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
            title="Previous match (Shift+F3)"
          >
            ↑
          </button>
          <button
            onClick={goToNextMatch}
            disabled={searchResultCount === 0}
            className="rounded px-1.5 py-1 text-xs text-on-surface-muted hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
            title="Next match (F3)"
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

      {/* Document content */}
      <div className="reading-viewport">
        <article ref={scrollRef} className="reader-page-canvas" tabIndex={-1}>
          <div ref={documentBodyRef} className="document-body reader-page-inner">
            <div className="document-preface">
              <div className="document-breadcrumb">
                <span>{fileName?.replace(/\.[^.]+$/, '') || 'Markdown'}</span>
                <span>·</span>
                <span>{wordCount.toLocaleString()} words</span>
                <span>·</span>
                <span>약 {readingTime}분</span>
              </div>
              <div className="document-section-label">Reading document</div>
              <h1 className={`reader-title ${sectionLabel.length > 64 ? 'reader-title-long' : ''}`}>
                {sectionLabel}
              </h1>
            </div>
            <MetadataCard content={content} hideTitle={quarto} />
            <div className="reader-markdown-content">
              <MarkdownRenderer content={renderedContent} filePath={tab.filePath} quarto={quarto} />
            </div>
          </div>
        </article>
      </div>

      <ReadingPaneFooter
        progress={scrollProgress}
        detail={scrollProgress >= 0.99 ? '읽기 완료' : `약 ${Math.max(1, Math.ceil(readingTime * (1 - scrollProgress)))}분 남음`}
      />
      <ReadingSensesPanel />

      {/* Link hover tooltip */}
      {hoveredLink && (
        <LinkTooltip key={`${hoveredLink.url}:${hoveredLink.title}`} tooltipRef={tooltipRef} url={hoveredLink.url} title={hoveredLink.title} rect={hoveredLink.rect} />
      )}

      {/* Text selection menu */}
      {selectionRect && selectedText && (
        <TextSelectionMenu
          rect={selectionRect}
          selectedText={selectedText}
          onHighlight={handleHighlightSelection}
          onClose={clearSelection}
        />
      )}
    </div>
  )
}

export function DocumentReader() {
  const { activeTab } = useDocumentStore()

  if (!activeTab) return null
  if (activeTab.kind === 'epub') return <EpubDocumentView tab={activeTab} />
  return <MarkdownDocumentView tab={activeTab} />
}
