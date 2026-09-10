import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBibIndex,
  findBibEntryForExternalLink,
  findBibEntryForInternalLink,
  formatBibEntry,
  getDoiUrl
} from '../utils/bibtex'

interface HoveredLinkState {
  rect: DOMRect
  title: string
  url: string | null
}

interface UseLinkTooltipOptions {
  bibContent: string | null
  content: string
  documentKey: string
  scrollRef: RefObject<HTMLElement | null>
}

export function useLinkTooltip({ bibContent, content, documentKey, scrollRef }: UseLinkTooltipOptions) {
  const [hoveredLink, setHoveredLink] = useState<HoveredLinkState | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const bibIndex = useMemo(() => buildBibIndex(bibContent), [bibContent])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    setHoveredLink(null)
    let hideTimeout: ReturnType<typeof setTimeout> | null = null
    let activeAnchor: HTMLAnchorElement | null = null

    const cancelHide = () => {
      if (hideTimeout) clearTimeout(hideTimeout)
      hideTimeout = null
    }
    const hide = () => {
      cancelHide()
      activeAnchor = null
      setHoveredLink(null)
    }
    const scheduleHide = () => {
      if (!hideTimeout) hideTimeout = setTimeout(hide, 250)
    }
    const handleTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return
      if (tooltipRef.current?.contains(target)) {
        cancelHide()
        return
      }
      const anchor = target.closest('a')
      if (!anchor || !container.contains(anchor)) {
        scheduleHide()
        return
      }
      cancelHide()
      if (anchor === activeAnchor) return
      activeAnchor = anchor
      const href = anchor.getAttribute('href') || ''
      const isExternal = /^https?:\/\//i.test(href)
      const entry = isExternal
        ? findBibEntryForExternalLink(href, anchor.textContent || '', bibIndex)
        : href.startsWith('#') ? findBibEntryForInternalLink(href.slice(1), bibIndex) : null
      let title = (entry && formatBibEntry(entry)) || anchor.getAttribute('title') || ''
      if (!title && isExternal) title = anchor.textContent || href
      if (!title && href.startsWith('#')) {
        const targetEl = document.getElementById(href.slice(1))
        if (targetEl && container.contains(targetEl)) {
          const clone = targetEl.cloneNode(true) as HTMLElement
          clone.querySelectorAll('a[href^="#"]').forEach((backLink) => backLink.remove())
          title = clone.textContent?.trim() || ''
        }
      }
      setHoveredLink(title ? {
        url: getDoiUrl(entry?.doi ?? null) || (isExternal ? href : null),
        title,
        rect: anchor.getBoundingClientRect()
      } : null)
    }
    const handlePointer = (event: PointerEvent) => handleTarget(event.target)
    const handleFocus = (event: FocusEvent) => handleTarget(event.target)
    const handleBlur = (event: FocusEvent) => {
      if (event.relatedTarget) handleTarget(event.relatedTarget)
      else scheduleHide()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', handlePointer)
    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', handleBlur)
    document.addEventListener('keydown', handleKeyDown)
    container.addEventListener('scroll', hide, { passive: true })
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    return () => {
      cancelHide()
      document.removeEventListener('pointerover', handlePointer)
      document.removeEventListener('focusin', handleFocus)
      document.removeEventListener('focusout', handleBlur)
      document.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('scroll', hide)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      document.documentElement.removeEventListener('pointerleave', hide)
    }
  }, [bibIndex, content, documentKey, scrollRef])

  return { hoveredLink, tooltipRef }
}
