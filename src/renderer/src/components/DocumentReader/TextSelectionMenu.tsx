import { useChatStore } from '../../store/useChatStore'
import { useUIStore } from '../../store/useUIStore'
import { useDocumentStore } from '../../store/useDocumentStore'
import { useTtsStore } from '../../store/useTtsStore'

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
  const { speakSelection } = useTtsStore()

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

  const handleSpeakSelection = () => {
    void speakSelection(selectedText)
    closeMenu()
  }

  const top = Math.max(46, rect.top - 48)
  const left = Math.min(Math.max(rect.left + rect.width / 2, 220), window.innerWidth - 220)
  const itemClass = 'selection-menu-item'
  const iconClass = 'h-3.5 w-3.5 shrink-0'

  return (
    <div
      data-selection-menu="true"
      onMouseDown={(e) => e.preventDefault()}
      className="selection-floating-menu fixed z-50 flex items-center gap-0 rounded-lg border px-1 py-1 ui-text"
      style={{
        top: `${Math.max(8, top)}px`,
        left: `${left}px`,
        transform: 'translateX(-50%)',
        background: 'var(--selection-menu-bg)',
        borderColor: 'var(--selection-menu-hair)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <button
        onClick={handleAskAI}
        className="selection-menu-primary"
      >
        <svg className={iconClass} viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M8 1.75l.9 3.35L12.25 6l-3.35.9L8 10.25l-.9-3.35L3.75 6l3.35-.9L8 1.75z" /></svg>
        Ask AI
      </button>
      <div className="mx-1 h-4 w-px bg-white/10" />
      <button
        onClick={handleSummarize}
        className={itemClass}
      >
        <svg className={iconClass} viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M4 4h8M4 8h8M4 12h8" /></svg>
        Summarize
      </button>
      <div className="h-4 w-px bg-white/10" />
      <button
        onClick={handleHighlight}
        className={itemClass}
      >
        <svg className={iconClass} viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M3 11.5l4.5-9 5.5 5.5-9 4.5zM8.5 3.5l4 4" /></svg>
        Highlight
      </button>
      <div className="h-4 w-px bg-white/10" />
      <button
        onClick={handleSpeakSelection}
        className={itemClass}
        title="Read selected text"
      >
        <svg className={iconClass} viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M2.75 8.5a5.25 5.25 0 0 1 10.5 0M2.75 8.5v3.75h2v-4h-2zM13.25 8.5v3.75h-2v-4h2z" /></svg>
        Read
      </button>
      <div className="h-4 w-px bg-white/10" />
      <button
        onClick={handleCopy}
        className={itemClass}
      >
        <svg className={iconClass} viewBox="0 0 16 16" aria-hidden="true"><path className="icon-stroke" d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" /></svg>
        Copy
      </button>
    </div>
  )
}
