import { Button } from '../ui/button'
interface QuickActionsProps {
  onAction: (prompt: string) => void
  disabled: boolean
}

const actions = [
  { icon: 'M4 4h8M4 8h8M4 12h8', label: '요약', title: 'Summarize', prompt: 'Please summarize this document. Highlight the key arguments, methods, and conclusions.' },
  { icon: 'M6.25 2.5v4.2L3.5 12.5h9L9.75 6.7V2.5', label: '분석', title: 'Analyze', prompt: 'Please provide a critical analysis of this document, including strengths, weaknesses, and potential implications.' },
  { icon: 'M8 2.5v11M4.5 6a3.5 3.5 0 0 1 7 0c0 2-1.5 2.5-3.5 2.5S4.5 8 4.5 6z', label: '핵심 개념', title: 'Key Concepts', prompt: 'List and briefly explain the key concepts and terms discussed in this document.' },
]

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="chat-quick-actions">
      {actions.map((action) => (
        <Button variant="outline" size="sm"
          key={action.label}
          title={action.title}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}

        >
          <svg data-icon="inline-start" viewBox="0 0 16 16" aria-hidden="true">
            <path className="icon-stroke" d={action.icon} />
          </svg>
          <span>{action.label}</span>
        </Button>
      ))}
    </div>
  )
}
