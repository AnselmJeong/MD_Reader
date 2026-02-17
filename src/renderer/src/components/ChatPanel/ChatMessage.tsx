import { useMemo } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import type { ChatMessage as ChatMessageType } from '../../store/useChatStore'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

function renderChatMarkdown(content: string): string {
  try {
    const result = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeHighlight, { detect: true })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(content)
    return String(result)
  } catch {
    return content
  }
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const html = useMemo(() => renderChatMarkdown(message.content), [message.content])
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-chat-user text-on-surface rounded-br-sm'
            : 'bg-chat-ai text-on-surface border border-border rounded-bl-sm'
        } ${isStreaming ? 'animate-pulse' : ''}`}
      >
        {/* Quoted text */}
        {message.quotedText && (
          <div className="mb-2 px-3 py-1.5 border-l-2 border-accent/50 text-xs text-on-surface-muted bg-surface/50 rounded-r-md">
            {message.quotedText.length > 200
              ? message.quotedText.slice(0, 200) + '...'
              : message.quotedText}
          </div>
        )}

        {/* Content */}
        <div
          className="chat-message-content prose prose-sm max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:text-xs [&_code]:text-xs"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-accent/60 animate-pulse rounded-sm" />
        )}

        {/* Actions */}
        {!isStreaming && !isUser && (
          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-border/50">
            <button
              onClick={() => navigator.clipboard.writeText(message.content)}
              className="text-[10px] text-on-surface-muted hover:text-on-surface transition-colors"
            >
              📋 Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
