import { useChatStore } from '../../store/useChatStore'
import { useUIStore } from '../../store/useUIStore'
import { useDocumentStore } from '../../store/useDocumentStore'

interface TextSelectionMenuProps {
  rect: DOMRect
  selectedText: string
  onClose: () => void
}

export function TextSelectionMenu({ rect, selectedText, onClose }: TextSelectionMenuProps) {
  const { addMessage } = useChatStore()
  const { showChat } = useUIStore()
  const { toggleChat } = useUIStore()
  const { content } = useDocumentStore()

  const sendToChat = (prompt: string) => {
    if (!showChat) toggleChat()
    addMessage({
      role: 'user',
      content: prompt,
      quotedText: selectedText
    })
    onClose()
    window.getSelection()?.removeAllRanges()
  }

  const handleAskAI = () => {
    sendToChat(`Regarding this passage:\n\n> ${selectedText}\n\nPlease explain this in detail.`)
  }

  const handleSummarize = () => {
    sendToChat(`Please summarize the following passage:\n\n> ${selectedText}`)
  }

  const handleExplain = () => {
    sendToChat(`Please explain the key terms and concepts in this passage:\n\n> ${selectedText}`)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedText)
    onClose()
  }

  const top = rect.top - 48
  const left = rect.left + rect.width / 2

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 px-1.5 py-1 rounded-lg border border-border ui-text"
      style={{
        top: `${Math.max(8, top)}px`,
        left: `${left}px`,
        transform: 'translateX(-50%)',
        background: 'var(--color-selection-menu)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <button
        onClick={handleAskAI}
        className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-xs font-medium text-accent"
      >
        💬 Ask AI
      </button>
      <div className="w-px h-4 bg-border" />
      <button
        onClick={handleSummarize}
        className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-xs text-on-surface-muted"
      >
        📝 Summarize
      </button>
      <div className="w-px h-4 bg-border" />
      <button
        onClick={handleExplain}
        className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-xs text-on-surface-muted"
      >
        📖 Explain
      </button>
      <div className="w-px h-4 bg-border" />
      <button
        onClick={handleCopy}
        className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-xs text-on-surface-muted"
      >
        📋 Copy
      </button>
    </div>
  )
}
