import { useChatStore } from '../../store/useChatStore'
import { useUIStore } from '../../store/useUIStore'
import { useDocumentStore } from '../../store/useDocumentStore'

interface TextSelectionMenuProps {
  rect: DOMRect
  selectedText: string
  onHighlight: () => void
  onClose: () => void
}

export function TextSelectionMenu({ rect, selectedText, onHighlight, onClose }: TextSelectionMenuProps) {
  const { sendMessage, setInputDraft, requestInputFocus, selectedModel, isStreaming } = useChatStore()
  const { showChat } = useUIStore()
  const { toggleChat } = useUIStore()
  const { content } = useDocumentStore()

  const ensureChatOpen = () => {
    if (!showChat) toggleChat()
  }

  const closeMenu = () => {
    onClose()
    window.getSelection()?.removeAllRanges()
  }

  const sendToAI = (prompt: string) => {
    ensureChatOpen()

    if (!selectedModel || isStreaming) {
      setInputDraft(prompt)
      closeMenu()
      return
    }

    closeMenu()
    void sendMessage({
      text: prompt,
      documentContent: content,
      quotedText: selectedText
    })
  }

  const handleAskAI = () => {
    ensureChatOpen()
    setInputDraft(selectedText)
    requestInputFocus()
    closeMenu()
  }

  const handleSummarize = () => {
    sendToAI(`Summarize the selected passage in 3-5 concise bullet points:\n\n${selectedText}`)
  }

  const handleHighlight = () => {
    onHighlight()
    closeMenu()
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedText)
    } catch (error) {
      console.error('Failed to copy selection:', error)
    }
    closeMenu()
  }

  const top = rect.top - 48
  const left = rect.left + rect.width / 2

  return (
    <div
      data-selection-menu="true"
      onMouseDown={(e) => e.preventDefault()}
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
        onClick={handleHighlight}
        className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-xs text-on-surface-muted"
      >
        ✨ Highlight
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
