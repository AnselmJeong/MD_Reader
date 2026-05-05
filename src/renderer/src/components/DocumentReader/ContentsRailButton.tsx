interface ContentsRailButtonProps {
  active: boolean
  onClick: () => void
}

export function ContentsRailButton({ active, onClick }: ContentsRailButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`reader-rail-toc-button ${active ? 'active' : ''}`}
      title={active ? 'Hide contents' : 'Show contents'}
      aria-label={active ? 'Hide contents' : 'Show contents'}
      aria-pressed={active}
    >
      <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
        <path className="icon-stroke" d="M3 4h10M3 8h10M3 12h10" />
      </svg>
    </button>
  )
}
