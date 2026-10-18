import { useLayoutEffect, useRef, useState } from 'react'

export function useChatScroll(resetKey: string, historical: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const lastScrollTop = useRef(0)
  const [showLatest, setShowLatest] = useState(false)

  const scrollToLatest = () => {
    followingRef.current = true
    const viewport = viewportRef.current
    if (viewport) {
      // scrollIntoView also scrolls overflow-hidden ancestors of the sidebar.
      viewport.scrollTop = viewport.scrollHeight
      lastScrollTop.current = viewport.scrollTop
    }
    setShowLatest(false)
  }

  useLayoutEffect(() => {
    followingRef.current = !historical
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollTop = historical ? 0 : viewport.scrollHeight
      lastScrollTop.current = viewport.scrollTop
    }
    setShowLatest(false)
  }, [resetKey, historical])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    const onResize = () => {
      // Observe the rendered content, including deferred Markdown, math and images.
      if (followingRef.current) {
        viewport.scrollTop = viewport.scrollHeight
        lastScrollTop.current = viewport.scrollTop
      }
      setShowLatest(!followingRef.current && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 24)
    }
    const onScroll = () => {
      const nearBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24
      if (viewport.scrollTop < lastScrollTop.current - 1) followingRef.current = false
      else if (nearBottom) followingRef.current = true
      lastScrollTop.current = viewport.scrollTop
      setShowLatest(!followingRef.current && !nearBottom)
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && viewport.scrollHeight > viewport.clientHeight) {
        followingRef.current = false
      }
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(viewport)
    observer.observe(content)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewport.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', onScroll)
      viewport.removeEventListener('wheel', onWheel)
    }
  }, [])

  return { viewportRef, contentRef, showLatest, scrollToLatest }
}
