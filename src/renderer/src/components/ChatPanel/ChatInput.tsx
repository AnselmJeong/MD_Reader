import { useRef, useEffect } from 'react'
import { useChatStore } from '../../store/useChatStore'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const input = useChatStore((s) => s.inputDraft)
  const setInputDraft = useChatStore((s) => s.setInputDraft)
  const focusInputRequest = useChatStore((s) => s.focusInputRequest)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || ta.disabled) return
    ta.focus()
    const end = ta.value.length
    ta.setSelectionRange(end, end)
  }, [focusInputRequest])

  const handleSend = () => {
    if (!input.trim() || disabled) return
    onSend(input.trim())
    setInputDraft('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-surface-alt/50">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInputDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Select an Ollama model...' : 'Ask about the document... (Enter to send)'}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-muted/50 outline-none focus:border-accent transition-colors disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !input.trim()}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
        </svg>
      </button>
    </div>
  )
}
