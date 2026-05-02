import { useEffect, useRef, useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MetadataCard } from './MetadataCard'
import { TableOfContents } from './TableOfContents'
import { ReadingProgress } from './ReadingProgress'
import { TextSelectionMenu } from './TextSelectionMenu'
import { LinkTooltip } from './LinkTooltip'
import { useDocumentSearch } from './hooks/useDocumentSearch'
import { useTextSelectionHighlight } from './hooks/useTextSelectionHighlight'
import { useLinkTooltip } from './hooks/useLinkTooltip'
import { useDocumentStore } from '../../store/useDocumentStore'
import { useUIStore } from '../../store/useUIStore'
import { useTtsStore } from '../../store/useTtsStore'
import { clearTtsMarks, markSpokenText } from './utils/ttsDom'

export function DocumentReader() {
  const { content, bibContent, updateContent } = useDocumentStore()
  const { showToC, showSearch, setShowSearch } = useUIStore()
  const { activeUtteranceId, state: ttsState, utterances } = useTtsStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const documentBodyRef = useRef<HTMLDivElement>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const hoveredLink = useLinkTooltip({ bibContent, scrollRef })
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
    <div className="relative h-full">
      {/* Reading progress bar */}
      <ReadingProgress progress={scrollProgress} />

      {/* Table of Contents overlay */}
      {showToC && <TableOfContents content={content} scrollContainer={scrollRef as React.RefObject<HTMLDivElement>} />}

      {showSearch && (
        <div
          data-search-panel="true"
          className="absolute top-3 right-4 z-30 flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-2 py-1.5 shadow-md"
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
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={documentBodyRef} className="document-body">
          <MetadataCard content={content} />
          <MarkdownRenderer content={content} />
        </div>
      </div>

      {/* Link hover tooltip */}
      {hoveredLink && (
        <LinkTooltip url={hoveredLink.url} title={hoveredLink.title} rect={hoveredLink.rect} />
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
