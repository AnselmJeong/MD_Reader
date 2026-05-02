import { useMemo, RefObject } from 'react'
import { useUIStore } from '../../store/useUIStore'
import { extractMarkdownHeadings, createHeadingSlug } from './utils/headings'

interface TableOfContentsProps {
  content: string
  scrollContainer: RefObject<HTMLDivElement>
}

export function TableOfContents({ content, scrollContainer }: TableOfContentsProps) {
  const { toggleToC } = useUIStore()

  const headings = useMemo(() => extractMarkdownHeadings(content), [content])

  const handleClick = (id: string) => {
    const container = scrollContainer.current
    if (!container) return

    const escapedId = window.CSS?.escape ? window.CSS.escape(id) : id.replace(/"/g, '\\"')
    const el = container.querySelector(`#${escapedId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const fallbackHeading = Array.from(container.querySelectorAll('h1, h2, h3, h4')).find((heading) => {
      return createHeadingSlug(heading.textContent ?? '') === id
    })
    fallbackHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="absolute top-0 left-0 z-30 w-72 h-full bg-surface-alt/95 backdrop-blur-sm border-r border-border shadow-lg overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-surface-alt/95 backdrop-blur-sm flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm text-on-surface ui-text">Table of Contents</span>
        <button
          onClick={toggleToC}
          className="text-on-surface-muted hover:text-on-surface transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Items */}
      <div className="p-3">
        {headings.map((h, i) => (
          <button
            key={i}
            onClick={() => handleClick(h.id)}
            className="w-full text-left px-3 py-1.5 rounded-md text-sm hover:bg-surface transition-colors truncate ui-text"
            style={{ paddingLeft: `${(h.level - 1) * 16 + 12}px` }}
          >
            <span className={h.level === 1 ? 'font-semibold text-on-surface' : 'text-on-surface-muted'}>
              {h.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
