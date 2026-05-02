import { useState, useRef, useEffect } from 'react'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { QuickActions } from './QuickActions'
import { useChatStore } from '../../store/useChatStore'
import { useDocumentStore } from '../../store/useDocumentStore'

export function ChatPanel() {
  const {
    messages, isStreaming, streamingContent,
    selectedModel, availableModels,
    addMessage, sendMessage, updateStreamingContent,
    finalizeStreaming, clearMessages, setSelectedModel
  } = useChatStore()
  const { content } = useDocumentStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedContext = [...messages].reverse().find((message) => message.quotedText)?.quotedText

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Set up streaming listeners
  useEffect(() => {
    const unsubToken = window.api.ollama.onToken((token) => {
      updateStreamingContent(token)
    })
    const unsubDone = window.api.ollama.onDone(() => {
      finalizeStreaming()
    })
    const unsubError = window.api.ollama.onError((error) => {
      finalizeStreaming()
      addMessage({ role: 'assistant', content: `Error: ${error}` })
    })
    return () => {
      unsubToken()
      unsubDone()
      unsubError()
    }
  }, [])

  const handleSendMessage = async (text: string) => {
    await sendMessage({ text, documentContent: content })
  }

  const handleExport = async () => {
    const md = messages
      .map((m) => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}`)
      .join('\n\n---\n\n')
    await window.api.chat.exportMarkdown(`# Chat Export\n\n${md}`)
  }

  return (
    <div className="flex h-full flex-col bg-chat-bg ui-text">
      {/* Header */}
      <div className="flex h-[66px] items-center justify-between gap-3 border-b border-border bg-surface-alt px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-on-surface text-surface">
            <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
              <path className="icon-stroke" d="M8 1.75l.9 3.35L12.25 6l-3.35.9L8 10.25l-.9-3.35L3.75 6l3.35-.9L8 1.75z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-none text-on-surface">Conversation</div>
          {availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              title={selectedModel}
              className="mt-1 block w-full max-w-[112px] appearance-none truncate bg-transparent text-[10px] font-medium uppercase leading-tight tracking-[0.08em] text-on-surface-muted outline-none"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={handleExport}
            className="rounded border border-[var(--hair-2)] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface"
            title="Export chat (⌘⇧E)"
          >
            Export
          </button>
          <button
            onClick={clearMessages}
            className="rounded border border-[var(--hair-2)] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {selectedContext && (
          <div className="rounded-md border border-[var(--hair-2)] bg-surface px-3.5 py-3">
            <div className="small-caps mb-2 flex items-center gap-2 text-on-surface-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>Selected Context · 1 Passage</span>
            </div>
            <p className="line-clamp-2 font-serif text-[13px] italic leading-relaxed text-on-surface">
              "{selectedContext}"
            </p>
          </div>
        )}
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center text-on-surface-muted">
            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-[var(--hair-3)]">
              <svg className="h-5 w-5 text-accent" viewBox="0 0 16 16" aria-hidden="true">
                <path className="icon-stroke" d="M8 1.75l.9 3.35L12.25 6l-3.35.9L8 10.25l-.9-3.35L3.75 6l3.35-.9L8 1.75z" />
              </svg>
            </div>
            <p className="font-serif text-[18px] leading-snug text-on-surface">Your reading<br />companion is ready.</p>
            <p className="mt-5 max-w-[230px] text-[12px] font-medium leading-6">
              Open a document to begin a conversation. Select any passage to ask, summarize, or extract.
            </p>
            <div className="my-8 h-px w-full border-t border-dashed border-[var(--hair-3)]" />
            <div className="small-caps mb-4">Try After Opening</div>
            <div className="w-full space-y-2">
              {['What is the central thesis?', 'List unfamiliar terms.', 'Compare with prior reading.'].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSendMessage(prompt)}
                  disabled={!content || isStreaming || !selectedModel}
                  className="w-full rounded-md border border-[var(--hair-2)] bg-surface px-3 py-2 text-left font-serif text-[13px] italic text-on-surface transition-colors hover:border-[var(--hair-3)] disabled:opacity-60"
                >
                  "{prompt}"
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isStreaming && (
          streamingContent ? (
            <ChatMessage
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingContent,
                timestamp: Date.now()
              }}
              isStreaming
            />
          ) : (
            <div className="flex justify-start max-w-full">
              <div className="px-1 py-3 text-sm text-on-surface">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted [animation-delay:-0.3s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted [animation-delay:-0.15s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted"></span>
                </div>
              </div>
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <QuickActions onAction={handleSendMessage} disabled={isStreaming || !selectedModel} />

      {/* Input */}
      <ChatInput onSend={handleSendMessage} disabled={isStreaming || !selectedModel} />
    </div>
  )
}
