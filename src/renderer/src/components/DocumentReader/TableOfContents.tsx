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
    <div className="h-full w-72 shrink-0 overflow-y-auto border-r border-border bg-surface-alt">
      {/* Header */}
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

      {/* Items */}
      <div className="p-3">
        {headings.map((h, i) => (
          <button
            key={i}
            onClick={() => handleClick(h.id)}
            className="w-full truncate rounded-md px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--ink-3)] ui-text"
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
