import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { QuickActions } from './QuickActions'
import { useChatStore } from '../../store/useChatStore'
import { useDocumentStore } from '../../store/useDocumentStore'

export function ChatPanel() {
  const {
    messages, isStreaming, streamingContent,
    selectedModel, availableModels, systemPrompt,
    addMessage, startStreaming, updateStreamingContent,
    finalizeStreaming, clearMessages, setSelectedModel
  } = useChatStore()
  const { content } = useDocumentStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      addMessage({ role: 'assistant', content: `⚠️ Error: ${error}` })
    })
    return () => {
      unsubToken()
      unsubDone()
      unsubError()
    }
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !selectedModel || isStreaming) return

    addMessage({ role: 'user', content: text })
    startStreaming()

    const chatMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text }
    ]

    // Include document content as system prompt context
    let fullSystemPrompt = systemPrompt
    if (content) {
      fullSystemPrompt += `\n\n---\n\nHere is the document the user is reading:\n\n${content}`
    }

    await window.api.ollama.chat({
      model: selectedModel,
      messages: chatMessages,
      systemPrompt: fullSystemPrompt
    })
  }, [selectedModel, isStreaming, messages, content, systemPrompt, addMessage, startStreaming])

  const handleExport = async () => {
    const md = messages
      .map((m) => `### ${m.role === 'user' ? '🧑 User' : '🤖 Assistant'}\n\n${m.content}`)
      .join('\n\n---\n\n')
    await window.api.chat.exportMarkdown(`# Chat Export\n\n${md}`)
  }

  return (
    <div className="h-full flex flex-col bg-chat-bg ui-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-alt/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-on-surface">AI Chat</span>
          {availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs bg-surface border border-border rounded-md px-2 py-0.5 text-on-surface-muted outline-none focus:border-accent"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExport}
            className="text-xs text-on-surface-muted hover:text-on-surface px-2 py-1 rounded-md hover:bg-surface transition-colors"
            title="Export chat (⌘⇧E)"
          >
            Export
          </button>
          <button
            onClick={clearMessages}
            className="text-xs text-on-surface-muted hover:text-on-surface px-2 py-1 rounded-md hover:bg-surface transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-w-0">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-on-surface-muted text-sm py-8">
            <p className="text-2xl mb-3">🤖</p>
            <p className="font-medium mb-1">Ask questions about the document</p>
            <p className="text-xs">Select text in the document or use Quick Actions below</p>
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
              <div className="bg-surface border border-border rounded-2xl rounded-tl-none px-4 py-3 text-sm text-on-surface shadow-sm">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-on-surface-muted rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 bg-on-surface-muted rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 bg-on-surface-muted rounded-full animate-bounce"></span>
                </div>
              </div>
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <QuickActions onAction={sendMessage} disabled={isStreaming || !selectedModel} />

      {/* Input */}
      <ChatInput onSend={sendMessage} disabled={isStreaming || !selectedModel} />
    </div>
  )
}
