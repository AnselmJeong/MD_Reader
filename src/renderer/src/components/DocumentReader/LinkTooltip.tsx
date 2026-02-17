interface LinkTooltipProps {
  url: string
  title: string
  rect: DOMRect
}

/**
 * Minimal floating tooltip showing the link title on hover.
 */
export function LinkTooltip({ url, title, rect }: LinkTooltipProps) {
  const displayTitle = title && title !== url ? title : ''
  if (!displayTitle) return null

  const top = rect.bottom + 6
  const left = rect.left + rect.width / 2

  return (
    <div
      className="fixed z-40 pointer-events-none"
      style={{
        top: `${top}px`,
        left: `${Math.max(16, Math.min(left, window.innerWidth - 200))}px`,
        transform: 'translateX(-50%)',
      }}
    >
      <div
        className="max-w-[360px] px-3 py-1.5 rounded-md border border-border ui-text text-xs text-on-surface"
        style={{
          background: 'var(--color-surface-alt)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {displayTitle}
      </div>
    </div>
  )
}
