interface QuickActionsProps {
  onAction: (prompt: string) => void
  disabled: boolean
}

const actions = [
  { label: '📝 Summarize', prompt: 'Please summarize this document. Highlight the key arguments, methods, and conclusions.' },
  { label: '🔬 Analyze', prompt: 'Please provide a critical analysis of this document, including strengths, weaknesses, and potential implications.' },
  { label: '🔑 Key Concepts', prompt: 'List and briefly explain the key concepts and terms discussed in this document.' },
]

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border/50">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}
          className="px-2.5 py-1 rounded-full border border-border text-xs text-on-surface-muted hover:text-on-surface hover:border-accent hover:bg-surface transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
