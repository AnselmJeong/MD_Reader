import { RefObject, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface LinkTooltipProps {
  url: string | null
  title: string
  rect: DOMRect
  tooltipRef: RefObject<HTMLDivElement | null>
}

export function LinkTooltip({ url, title, rect, tooltipRef }: LinkTooltipProps) {
  const [position, setPosition] = useState({ top: rect.bottom + 6, left: rect.left })
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    const bounds = tooltipRef.current?.getBoundingClientRect()
    if (!bounds) return
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8))
    const top = rect.bottom + bounds.height + 6 <= window.innerHeight - 8
      ? rect.bottom + 6 : Math.max(8, rect.top - bounds.height - 6)
    setPosition({ top, left })
  }, [rect, title, error, tooltipRef])

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-50 max-w-[360px] rounded-md border border-border px-3 py-2 ui-text text-xs text-on-surface"
      style={{ ...position, maxWidth: 'min(360px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', background: 'var(--color-surface-alt)', boxShadow: 'var(--shadow-md)' }}
    >
      {url ? (
        <a
          href={url}
          title="Open in default browser"
          className="block break-words text-accent hover:underline focus-visible:outline focus-visible:outline-2"
          onClick={(event) => {
            event.preventDefault()
            setError(null)
            void window.api.shell.openExternal(url).catch(() => setError('Could not open the link. Please try again.'))
          }}
        >
          {title}
          <span className="mt-1 block text-[10px] text-on-surface-muted">Open in browser ↗</span>
        </a>
      ) : <span className="break-words">{title}</span>}
      {error && <p role="alert" className="mt-1 text-red-500">{error}</p>}
    </div>,
    document.body
  )
}
