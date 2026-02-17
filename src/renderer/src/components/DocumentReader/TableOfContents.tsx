import { useMemo, RefObject } from 'react'
import { useUIStore } from '../../store/useUIStore'

interface ToCItem {
  level: number
  text: string
  id: string
}

interface TableOfContentsProps {
  content: string
  scrollContainer: RefObject<HTMLDivElement>
}

export function TableOfContents({ content, scrollContainer }: TableOfContentsProps) {
  const { toggleToC } = useUIStore()

  const headings = useMemo<ToCItem[]>(() => {
    const lines = content.split('\n')
    const items: ToCItem[] = []
    let inCodeBlock = false

    for (const line of lines) {
      if (line.trim().startsWith('```')) inCodeBlock = !inCodeBlock
      if (inCodeBlock) continue

      const match = line.match(/^(#{1,4})\s+(.+)/)
      if (match) {
        const level = match[1].length
        const text = match[2].replace(/[*_`\[\]]/g, '').trim()
        const id = text.toLowerCase().replace(/[^\w\s가-힣-]/g, '').replace(/\s+/g, '-')
        items.push({ level, text, id })
      }
    }
    return items
  }, [content])

  const handleClick = (id: string) => {
    const el = scrollContainer.current?.querySelector(`[id="${id}"], h1, h2, h3, h4`)
    // Find the heading by text content as a fallback
    if (!el) {
      const headings = scrollContainer.current?.querySelectorAll('h1, h2, h3, h4')
      headings?.forEach((h) => {
        const hText = h.textContent?.toLowerCase().replace(/[^\w\s가-힣-]/g, '').replace(/\s+/g, '-')
        if (hText === id) {
          h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
