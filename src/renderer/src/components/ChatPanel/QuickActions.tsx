interface QuickActionsProps {
  onAction: (prompt: string) => void
  disabled: boolean
}

const actions = [
  { icon: 'M4 4h8M4 8h8M4 12h8', label: 'Summarize', prompt: 'Please summarize this document. Highlight the key arguments, methods, and conclusions.' },
  { icon: 'M6.25 2.5v4.2L3.5 12.5h9L9.75 6.7V2.5', label: 'Analyze', prompt: 'Please provide a critical analysis of this document, including strengths, weaknesses, and potential implications.' },
  { icon: 'M8 2.5v11M4.5 6a3.5 3.5 0 0 1 7 0c0 2-1.5 2.5-3.5 2.5S4.5 8 4.5 6z', label: 'Key Concepts', prompt: 'List and briefly explain the key concepts and terms discussed in this document.' },
]

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-border px-4 py-3">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}
          className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--hair-2)] bg-surface px-2 py-1 text-[11.5px] font-medium leading-tight text-on-surface transition-colors hover:border-[var(--hair-3)] hover:bg-[var(--ink-3)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <svg className="h-3.5 w-3.5 shrink-0 text-accent" viewBox="0 0 16 16" aria-hidden="true">
            <path className="icon-stroke" d={action.icon} />
          </svg>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
