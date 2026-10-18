import { Sparkles, Plus, Download, BookOpen, Settings2, ArrowDown } from 'lucide-react'
import { Button } from '../ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../ui/empty'
import { useUIStore } from '../../store/useUIStore'
import { modelLabel } from '../../../../shared/subscription'
import { useMemo, useState, useEffect } from 'react'
import { useChatScroll } from './utils/useChatScroll'
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
    messages, isStreaming, isPreparingMessage, streamingContent, streamingSources, streamingSearchQuery,
    selectedModel, availableModels,
    availableSessions, currentSessionId, sessionView, isLoadingSession, pendingQuotedText,
    addMessage, sendMessage, updateStreamingContent,
    finalizeStreaming, cancelStreaming, setSelectedModel, loadSession, startNewSession,
    setStreamingSearchQuery, setStreamingSources
  } = useChatStore()
  const { content, fileName } = useDocumentStore()
  const lastQuestionId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? ''
  const { viewportRef, contentRef, showLatest, scrollToLatest } = useChatScroll(
    lastQuestionId, sessionView === 'historical'
  )
  const selectedContext = [...messages].reverse().find((message) => message.quotedText)?.quotedText

  // Set up streaming listeners
  useEffect(() => {
    const unsubToken = window.api.ai.onToken((token) => {
      updateStreamingContent(token)
    })
    const unsubSearchStart = window.api.ai.onSearchStart((payload) => {
      setStreamingSearchQuery(payload.query)
    })
    const unsubSearchResults = window.api.ai.onSearchResults((payload) => {
      setStreamingSources(payload.sources)
    })
    const unsubSearchEnd = window.api.ai.onSearchEnd(() => setStreamingSearchQuery(null))
    const unsubMetadata = window.api.ai.onMetadata((metadata) => {
      setStreamingSources(metadata.sources ?? [])
    })
    const unsubDone = window.api.ai.onDone(() => {
      finalizeStreaming()
    })
    const unsubStopped = window.api.ai.onStopped(() => {
      cancelStreaming()
    })
    const unsubError = window.api.ai.onError((error) => {
      finalizeStreaming()
      addMessage({ role: 'assistant', content: `Error: ${error}` })
    })
    return () => {
      unsubToken()
      unsubSearchStart()
      unsubSearchResults()
      unsubSearchEnd()
      unsubMetadata()
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
      .map((m) => {
        const sources = m.sources?.length
          ? `\n\nSources:\n${m.sources.map((source) => `- [${source.id}] [${source.title}](${source.url})`).join('\n')}`
          : ''
        return `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}${m.images?.map(image => `\n\n![${image.name.replace(/[\[\]\\]/g, '')}](mdr-chat-image:${image.id})`).join('') ?? ''}${sources}`
      })
      .join('\n\n---\n\n')
    await window.api.chat.exportMarkdown(`# Chat Export\n\n${md}`, messages.flatMap(message => message.images ?? []))
  }

  const handleSessionChange = async (sessionId: string) => {
    if (!sessionId) {
      await startNewSession()
      return
    }
    await loadSession(sessionId)
  }

  return (
    <div className="ai-sidebar chat-workspace ui-text">
      <header className="chat-heading">
        <div className="chat-heading-row">
          <span className="assistant-mark"><Sparkles /></span><h2>읽기 도우미</h2>
          <Button variant="ghost" size="icon-sm" onClick={handleExport} title="Export chat (⌘⇧E)" aria-label="대화 내보내기"><Download /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void startNewSession()} disabled={isLoadingSession || isStreaming || isPreparingMessage} title="새 대화" aria-label="새 대화"><Plus /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => useUIStore.getState().toggleSettings()} title="AI 설정" aria-label="AI 설정"><Settings2 /></Button>
        </div>
        <div className="chat-model-row">
          <select value={selectedModel} disabled={isStreaming || isPreparingMessage || !availableModels.length} onChange={e => setSelectedModel(e.target.value)} title={selectedModel} aria-label="AI 모델">
            {!selectedModel && <option value="">모델 선택</option>}
            {availableModels.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}
          </select>
        </div>
        <div className="chat-session-row">
          <select value={currentSessionId ?? ''} onChange={e => void handleSessionChange(e.target.value)} disabled={isLoadingSession || isStreaming || isPreparingMessage} title="Saved sessions for this reading context" aria-label="저장된 대화">
            <option value="">New session</option>
            {availableSessions.map(session => <option key={session.id} value={session.id}>{session.title} · {formatSessionDate(session.updatedAt)} · {session.messageCount}</option>)}
          </select>
        </div>
      </header>
      {fileName && <div className="chat-context" title={fileName}><BookOpen /><span>{fileName}</span></div>}

      {/* Messages */}
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={viewportRef} aria-label="Conversation messages" tabIndex={0} className="h-full min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <div ref={contentRef} className="min-h-full flex flex-col gap-5 px-5 py-4">
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
              <Empty className="chat-welcome"><EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>{fileName ? '어디부터 살펴볼까요?' : '읽고, 묻고, 연결하세요.'}</EmptyTitle><EmptyDescription>{fileName ? '핵심을 요약하거나, 문장을 선택해 함께 살펴보세요.' : '문서를 열면 본문을 바탕으로 대화할 수 있습니다.'}</EmptyDescription></EmptyHeader>
                {!selectedModel && <Button variant="outline" size="sm" onClick={() => useUIStore.getState().toggleSettings()}>AI 계정 연결</Button>}
              </Empty>
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
                    timestamp: Date.now(),
                    sources: streamingSources
                  }}
                  isStreaming
                />
              ) : (
                <div className="flex justify-start max-w-full">
                  <div className="px-1 py-3 text-sm text-on-surface">
                    {(
                      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-on-surface-muted">
                        {streamingSearchQuery ? '자료 검색 중…' : '답변 준비 중…'}
                      </div>
                    )}
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted [animation-delay:-0.3s]"></span>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted [animation-delay:-0.15s]"></span>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-muted"></span>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
        {showLatest && (
          <button onClick={scrollToLatest} title="Jump to latest answer" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-on-surface shadow-sm">
            Latest answer ↓
          </button>
        )}
      </div>

      {/* Quick Actions */}
      <QuickActions onAction={handleSendMessage} disabled={isStreaming || isPreparingMessage || !selectedModel} />

      {/* Input */}
      <ChatInput onSend={handleSendMessage} disabled={isStreaming || isPreparingMessage || !selectedModel} />
    </div>
  )
}
