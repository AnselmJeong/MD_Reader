import { useRef, useEffect, useState, useCallback } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { MetadataCard } from './MetadataCard'
import { TableOfContents } from './TableOfContents'
import { ReadingProgress } from './ReadingProgress'
import { TextSelectionMenu } from './TextSelectionMenu'
import { LinkTooltip } from './LinkTooltip'
import { useDocumentStore } from '../../store/useDocumentStore'
import { useUIStore } from '../../store/useUIStore'

// import { toJSON } from 'bibtex-parse-js' // Removed due to install issues

// Simple BibTeX parser
const parseBibTeX = (content: string) => {
  const entries: Record<string, any> = {}
  // Split by @ to get raw entries
  const rawEntries = content.split('@').slice(1)
  
  rawEntries.forEach(raw => {
    try {
      // Extract key: type{key,
      const firstBrace = raw.indexOf('{')
      const firstComma = raw.indexOf(',')
      if (firstBrace === -1 || firstComma === -1) return
      
      const key = raw.slice(firstBrace + 1, firstComma).trim()
      
      // Extract fields (simplified: field = {value} or "value")
      const extractField = (fieldName: string) => {
        // Support multi-line values using [\s\S]
        const regex = new RegExp(`${fieldName}\\s*=\\s*[\\{"]([\\s\\S]*?)[\\}"]`, 'i')
        const match = raw.match(regex)
        if (!match) return null
        
        // Clean up newlines and extra spaces within the value
        let value = match[1].replace(/[\{\}]/g, '')
        value = value.replace(/\s+/g, ' ').trim()
        return value
      }

      entries[key.toLowerCase()] = {
        key: key,
        title: extractField('title'),
        author: extractField('author'),
        year: extractField('year'),
        journal: extractField('journal'),
        doi: extractField('doi')
      }
    } catch { 
      // ignore malformed
    }
  })
  return entries
}

export function DocumentReader() {
  const { content, bibContent } = useDocumentStore()
  const { showToC } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  
  // Parse BibTeX
  const bibEntries = useRef<Record<string, any>>({}) // Key -> Entry
  const doiEntries = useRef<Record<string, any>>({}) // DOI -> Entry
  const authorYearEntries = useRef<Record<string, any>>({}) // "lastname_year" -> Entry

  useEffect(() => {
    if (bibContent) {
      const entries = parseBibTeX(bibContent)
      bibEntries.current = entries
      
      const byDoi: Record<string, any> = {}
      const byAuthorYear: Record<string, any> = {}

      Object.values(entries).forEach((entry: any) => {
        // Index by DOI
        if (entry.doi) {
          const cleanDoi = entry.doi.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').toLowerCase()
          byDoi[cleanDoi] = entry
        }

        // Index by Author+Year
        if (entry.author && entry.year) {
            // Extract first author's last name
            // "Breakspear, Michael" -> Breakspear
            // "Michael Breakspear" -> Breakspear
            // "Breakspear et al." -> Breakspear
            let author = entry.author.split(' and ')[0].trim() // First author
            if (author.includes(',')) {
                author = author.split(',')[0].trim()
            } else {
                const parts = author.split(' ')
                author = parts[parts.length - 1].trim()
            }
            // Remove non-alphanumeric
            author = author.replace(/[^a-zA-Z]/g, '').toLowerCase()
            const year = entry.year.replace(/[^0-9]/g, '')
            
            if (author && year) {
                const key = `${author}_${year}`
                // Only keep first match for now
                if (!byAuthorYear[key]) byAuthorYear[key] = entry
            }
        }
      })
      doiEntries.current = byDoi
      authorYearEntries.current = byAuthorYear
    } else {
      bibEntries.current = {}
      doiEntries.current = {}
      authorYearEntries.current = {}
    }
  }, [bibContent])

  // ... (rest of state) ...
  const [scrollProgress, setScrollProgress] = useState(0)
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [hoveredLink, setHoveredLink] = useState<{ url: string; title: string; rect: DOMRect } | null>(null)

  // ... (scroll logic) ...

  // Link hover tooltip
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let hideTimeout: ReturnType<typeof setTimeout> | null = null

    const formatBibEntry = (entry: any) => {
        const { title, year } = entry
        const parts = []
        if (title) parts.push(title)
        // User requested to hide authors
        // if (author) parts.push(`by ${author}`)
        if (year) parts.push(`(${year})`)
        return parts.join(' ')
    }

    const handleMouseMove = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')

      if (anchor) {
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
        const href = anchor.getAttribute('href') || ''
        let title = anchor.getAttribute('title') || '' 
        const rect = anchor.getBoundingClientRect()

        // Case 1: External Link (Start with http/https)
        if (href.startsWith('http://') || href.startsWith('https://')) {
          let entry = null

          // 1. Try DOI from URL
          const doiMatch = href.match(/doi\.org\/(10\..+)/i)
          if (doiMatch) {
            const doi = doiMatch[1].toLowerCase()
            entry = doiEntries.current[doi]
          }

          // 2. Try Author+Year from Text Content
          if (!entry) {
            const text = anchor.textContent || ''
            // Look for "Author, 20xx" or "Author (20xx)" or "Author et al., 20xx"
            // Regex: Name (word), then optional et al, then optional parens/comma, then year 19xx/20xx
            const match = text.match(/([A-Z][a-zA-Z\u00C0-\u00FF]+)(?:.*?et al\.?)?.*?(\d{4})/u)
            if (match) {
                const author = match[1].toLowerCase()
                const year = match[2]
                const key = `${author}_${year}`
                entry = authorYearEntries.current[key]
            }
          }

          if (entry) {
            title = formatBibEntry(entry)
          } else {
            title = title || anchor.textContent || href
          }

          setHoveredLink({ url: href, title, rect })
          return
        }

        // Case 2: Internal Link (Citation/Footnote) with BibTeX support
        if (href.startsWith('#')) {
          const targetId = href.slice(1)
          
          // Try BibTeX lookup first by Key
          const cleanKey = targetId.replace(/^(ref-|bib-|cite-)/i, '').toLowerCase()
          const bibEntry = bibEntries.current[cleanKey] || bibEntries.current[targetId.toLowerCase()]

          if (bibEntry) {
            title = formatBibEntry(bibEntry)
          } 
          
          // Fallback to DOM lookup if no BibTeX or no title found
          if (!title) {
            const targetEl = document.getElementById(targetId)
            if (targetEl) {
                const clone = targetEl.cloneNode(true) as HTMLElement
                const backLinks = clone.querySelectorAll('a[href^="#"]')
                backLinks.forEach(el => el.remove())
                title = clone.textContent?.trim() || ''
            }
          }

          if (title) {
            setHoveredLink({ url: href, title, rect })
          }
        }
      } else {
        // Mouse is not over a link — hide tooltip after short delay
        if (!hideTimeout) {
          hideTimeout = setTimeout(() => { setHoveredLink(null); hideTimeout = null }, 150)
        }
      }
    }

    el.addEventListener('mousemove', handleMouseMove)
    return () => {
      el.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeout) clearTimeout(hideTimeout)
    }
  }, [])

  // Track text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      if (selection && selection.toString().trim()) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        setSelectedText(selection.toString().trim())
        setSelectionRect(rect)
      } else {
        setSelectedText('')
        setSelectionRect(null)
      }
    }

    document.addEventListener('mouseup', handleSelection)
    return () => document.removeEventListener('mouseup', handleSelection)
  }, [])

  if (!content) return null

  return (
    <div className="relative h-full">
      {/* Reading progress bar */}
      <ReadingProgress progress={scrollProgress} />

      {/* Table of Contents overlay */}
      {showToC && <TableOfContents content={content} scrollContainer={scrollRef as React.RefObject<HTMLDivElement>} />}

      {/* Document content */}
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="document-body">
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
        <TextSelectionMenu rect={selectionRect} selectedText={selectedText} onClose={() => setSelectionRect(null)} />
      )}
    </div>
  )
}
