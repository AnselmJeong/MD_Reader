import { RefObject, useCallback, useEffect, useRef } from 'react'

const READING_BLOCK_SELECTOR = [
  '.reader-markdown-content > div > p',
  '.reader-markdown-content > div > blockquote',
  '.reader-markdown-content > div > ul',
  '.reader-markdown-content > div > ol',
  '.reader-markdown-content > div > pre',
  '.reader-markdown-content > div > table',
  '.reader-markdown-content > div > .callout'
].join(', ')

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest(
      'input, textarea, select, [contenteditable="true"], button, a, [role="button"], [role="slider"], [role="menuitem"]'
    ))
}

interface UseParagraphFocusOptions {
  enabled: boolean
  rootRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  contentKey: string
}

export function useParagraphFocus({
  enabled,
  rootRef,
  scrollRef,
  contentKey
}: UseParagraphFocusOptions) {
  const activeIndexRef = useRef(0)

  const getBlocks = useCallback(() => {
    const root = rootRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(READING_BLOCK_SELECTOR))
  }, [rootRef])

  const activate = useCallback((index: number, shouldScroll = true) => {
    const blocks = getBlocks()
    if (blocks.length === 0) return
    const nextIndex = Math.max(0, Math.min(blocks.length - 1, index))

    blocks.forEach((block, blockIndex) => {
      block.classList.toggle('reader-focus-active', blockIndex === nextIndex)
      block.tabIndex = enabled ? 0 : -1
    })
    rootRef.current?.classList.toggle('has-focus-active', enabled)
    activeIndexRef.current = nextIndex

    if (shouldScroll) {
      blocks[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [enabled, getBlocks, rootRef])

  useEffect(() => {
    const blocks = getBlocks()
    activeIndexRef.current = 0

    if (!enabled || blocks.length === 0) {
      blocks.forEach((block) => {
        block.classList.remove('reader-focus-active')
        block.removeAttribute('tabindex')
      })
      rootRef.current?.classList.remove('has-focus-active')
      return
    }

    const scrollContainer = scrollRef.current
    const readingLine = scrollContainer
      ? scrollContainer.getBoundingClientRect().top + scrollContainer.clientHeight * 0.4
      : window.innerHeight * 0.4
    const visibleIndex = blocks.reduce((candidate, block, index) => (
      block.getBoundingClientRect().top <= readingLine ? index : candidate
    ), 0)
    activate(visibleIndex, false)
  }, [activate, contentKey, enabled, getBlocks, rootRef, scrollRef])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      activate(activeIndexRef.current + (event.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activate, enabled])

  useEffect(() => {
    if (!enabled) return
    const root = rootRef.current
    if (!root) return

    const handleInteraction = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(READING_BLOCK_SELECTOR) : null
      if (!target) return
      const index = getBlocks().indexOf(target)
      if (index >= 0) activate(index, false)
    }
    root.addEventListener('click', handleInteraction)
    root.addEventListener('focusin', handleInteraction)
    return () => {
      root.removeEventListener('click', handleInteraction)
      root.removeEventListener('focusin', handleInteraction)
    }
  }, [activate, enabled, getBlocks, rootRef])

}
