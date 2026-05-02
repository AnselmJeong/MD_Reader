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
    ta.style.height = input.trim() ? Math.min(ta.scrollHeight, 80) + 'px' : '44px'
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
    <div className="flex items-end gap-2 border-t border-border bg-surface px-4 py-3">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInputDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Select model...' : 'Ask about the document...'}
        disabled={disabled}
        rows={1}
        className="min-h-11 flex-1 resize-none rounded-lg border border-[var(--hair-2)] bg-surface px-3 py-3 text-[12px] font-medium leading-5 text-on-surface outline-none transition-colors placeholder:text-on-surface-muted/65 focus:border-[var(--hair-3)] disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !input.trim()}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
          <path className="icon-stroke" d="M2.5 8l11-5-3.2 10-2.1-4.2L2.5 8zM8.2 8.8l2.1-2.2" />
        </svg>
      </button>
    </div>
  )
}
