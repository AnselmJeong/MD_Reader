import { RefObject, useEffect, useMemo, useState } from 'react'
import {
  buildBibIndex,
  findBibEntryForExternalLink,
  findBibEntryForInternalLink,
  formatBibEntry
} from '../utils/bibtex'

interface HoveredLinkState {
  rect: DOMRect
  title: string
  url: string
}

interface UseLinkTooltipOptions {
  bibContent: string | null
  scrollRef: RefObject<HTMLElement | null>
}

export function useLinkTooltip({ bibContent, scrollRef }: UseLinkTooltipOptions) {
  const [hoveredLink, setHoveredLink] = useState<HoveredLinkState | null>(null)
  const bibIndex = useMemo(() => buildBibIndex(bibContent), [bibContent])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    let hideTimeout: ReturnType<typeof setTimeout> | null = null

    const handleMouseMove = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a')
      if (!anchor) {
        if (!hideTimeout) {
          hideTimeout = setTimeout(() => {
            setHoveredLink(null)
            hideTimeout = null
          }, 150)
        }
        return
      }

      if (hideTimeout) {
        clearTimeout(hideTimeout)
        hideTimeout = null
      }

      const href = anchor.getAttribute('href') || ''
      let title = anchor.getAttribute('title') || ''
      const rect = anchor.getBoundingClientRect()

      if (href.startsWith('http://') || href.startsWith('https://')) {
        const entry = findBibEntryForExternalLink(href, anchor.textContent || '', bibIndex)
        title = entry ? formatBibEntry(entry) : title || anchor.textContent || href
        setHoveredLink({ url: href, title, rect })
        return
      }

      if (!href.startsWith('#')) {
        return
      }

      const targetId = href.slice(1)
      const entry = findBibEntryForInternalLink(targetId, bibIndex)
      if (entry) {
        title = formatBibEntry(entry)
      }

      if (!title) {
        const targetEl = document.getElementById(targetId)
        if (targetEl) {
          const clone = targetEl.cloneNode(true) as HTMLElement
          const backLinks = clone.querySelectorAll('a[href^="#"]')
          backLinks.forEach((backLink) => backLink.remove())
          title = clone.textContent?.trim() || ''
        }
      }

      if (title) {
        setHoveredLink({ url: href, title, rect })
      }
    }

    container.addEventListener('mousemove', handleMouseMove)
    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      if (hideTimeout) clearTimeout(hideTimeout)
    }
  }, [bibIndex, scrollRef])

  return hoveredLink
}
