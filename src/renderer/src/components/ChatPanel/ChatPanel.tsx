import { useMemo, useState, useRef, useEffect } from 'react'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { QuickActions } from './QuickActions'
import { ChatMessage as ChatMessageType, useChatStore } from '../../store/useChatStore'
import { useDocumentStore } from '../../store/useDocumentStore'

function formatSessionDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

function HistoricalTranscript({ messages }: { messages: ChatMessageType[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const groups = useMemo(() => {
    const result: Array<{ user: ChatMessageType; answers: ChatMessageType[] }> = []
    let current: { user: ChatMessageType; answers: ChatMessageType[] } | null = null

    for (const message of messages) {
      if (message.role === 'user') {
        current = { user: message, answers: [] }
        result.push(current)
      } else if (current) {
        current.answers.push(message)
      } else {
        current = {
          user: {
            id: `restored-question-${message.id}`,
            role: 'user',
            content: 'Restored answer',
            timestamp: message.timestamp
          },
          answers: [message]
        }
        result.push(current)
      }
    }

    return result
  }, [messages])

  const toggleAnswer = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.user.id} className="space-y-3">
          <ChatMessage message={group.user} />
          {group.answers.map((answer) => {
            const expanded = expandedIds.has(answer.id)
            return (
              <div key={answer.id} className="space-y-2">
                <button
                  onClick={() => toggleAnswer(answer.id)}
                  className="ml-1 rounded border border-[var(--hair-2)] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface"
                >
                  {expanded ? 'Hide answer' : 'Show answer'}
                </button>
                {expanded && <ChatMessage message={answer} />}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

export function ChatPanel() {
  const {
    messages, isStreaming, streamingContent,
    selectedModel, availableModels,
    availableSessions, currentSessionId, sessionView, isLoadingSession, pendingQuotedText,
    addMessage, sendMessage, updateStreamingContent,
    finalizeStreaming, cancelStreaming, setSelectedModel, loadSession, startNewSession
  } = useChatStore()
  const { activeTab, content } = useDocumentStore()
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
    const unsubStopped = window.api.ollama.onStopped(() => {
      cancelStreaming()
    })
    const unsubError = window.api.ollama.onError((error) => {
      finalizeStreaming()
      addMessage({ role: 'assistant', content: `Error: ${error}` })
    })
    return () => {
      unsubToken()
      unsubDone()
      unsubStopped()
      unsubError()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !useChatStore.getState().isStreaming) return
      event.preventDefault()
      void useChatStore.getState().stopStreaming()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleSendMessage = async (text: string) => {
    await sendMessage({
      text,
      documentContent: content,
      quotedText: pendingQuotedText ?? undefined
    })
  }

  const handleExport = async () => {
    const md = messages
      .map((m) => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}`)
      .join('\n\n---\n\n')
    await window.api.chat.exportMarkdown(`# Chat Export\n\n${md}`)
  }

  const handleSessionChange = async (sessionId: string) => {
    if (!sessionId) {
      await startNewSession()
      return
    }
    await loadSession(sessionId)
  }

  return (
    <div className="ai-sidebar flex h-full flex-col bg-chat-bg ui-text">
      {/* Header */}
      <div className="flex min-h-[86px] flex-col justify-center gap-2 border-b border-border bg-surface-alt px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
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
                  className="mt-1 block w-full max-w-[140px] appearance-none truncate bg-transparent text-[10px] font-medium uppercase leading-tight tracking-[0.08em] text-on-surface-muted outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <button
            onClick={handleExport}
            className="rounded border border-[var(--hair-2)] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface"
            title="Export chat (⌘⇧E)"
          >
            Export
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={currentSessionId ?? ''}
            onChange={(event) => void handleSessionChange(event.target.value)}
            disabled={isLoadingSession || isStreaming}
            className="min-w-0 flex-1 rounded border border-[var(--hair-2)] bg-surface px-2 py-1.5 text-[11px] text-on-surface outline-none transition-colors hover:border-[var(--hair-3)] disabled:opacity-60"
            title="Saved sessions for this reading context"
          >
            <option value="">New session</option>
            {availableSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} · {formatSessionDate(session.updatedAt)} · {session.messageCount}
              </option>
            ))}
          </select>
          <button
            onClick={() => void startNewSession()}
            disabled={isLoadingSession || isStreaming}
            className="shrink-0 rounded border border-[var(--hair-2)] px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface disabled:opacity-60"
          >
            New
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
          </div>
        )}
        {sessionView === 'historical' && !isStreaming
          ? <HistoricalTranscript messages={messages} />
          : messages.map((msg) => (
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
