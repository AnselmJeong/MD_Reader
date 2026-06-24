import { MouseEvent, useDeferredValue, useMemo } from 'react'
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

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderChatMarkdown(content: string, streaming: boolean): string {
  try {
    const result = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeHighlight, { detect: !streaming })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(content)
    return String(result)
  } catch {
    // During incomplete streaming markdown/math, keep content readable and safe.
    return escapeHtml(content).replace(/\n/g, '<br/>')
  }
}

function getSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const deferredContent = useDeferredValue(message.content)
  const contentForRender = isStreaming ? deferredContent : message.content
  const html = useMemo(
    () => renderChatMarkdown(contentForRender, Boolean(isStreaming)),
    [contentForRender, isStreaming]
  )
  const isUser = message.role === 'user'
  
  const handleLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('http://') && !href.startsWith('https://')) return

    event.preventDefault()
    void window.api.shell.openExternal(href)
  }

  const handleSourceClick = (url: string) => {
    void window.api.shell.openExternal(url)
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`min-w-0 text-[length:var(--ai-sidebar-font-size)] leading-relaxed ${
          isUser
            ? 'max-w-[92%] rounded-[8px_8px_2px_8px] border border-[var(--hair-2)] bg-chat-user px-3.5 py-3 font-sans font-medium text-chat-user-fg'
            : 'w-full max-w-full text-on-surface'
        }`}
      >
        {!isUser && (
          <div className="small-caps mb-2 flex items-center gap-2 text-on-surface-muted">
            <svg className="h-3 w-3 text-accent" viewBox="0 0 16 16" aria-hidden="true">
              <path className="icon-stroke" d="M8 1.75l.9 3.35L12.25 6l-3.35.9L8 10.25l-.9-3.35L3.75 6l3.35-.9L8 1.75z" />
            </svg>
            <span>Assistant</span>
          </div>
        )}
        {/* Quoted text */}
        {message.quotedText && (
          <div className="mb-3 rounded-md border border-[var(--hair-2)] bg-surface px-3 py-2 font-serif text-[12px] italic text-on-surface-muted">
            {message.quotedText.length > 200
              ? message.quotedText.slice(0, 200) + '...'
              : message.quotedText}
          </div>
        )}

        {/* Content */}
        <div
          onClick={handleLinkClick}
          className={`chat-message-content prose prose-sm max-w-none text-[length:var(--ai-sidebar-font-size)] [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:text-xs [&_code]:text-xs [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-2 ${
            isUser ? 'font-sans' : 'font-serif prose-p:font-serif prose-li:font-serif'
          }`}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-accent/60 animate-pulse rounded-sm" />
        )}

        {!isUser && Boolean(message.sources?.length) && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
            {message.sources?.map((source) => (
              <button
                key={`${source.id}-${source.url}`}
                onClick={() => handleSourceClick(source.url)}
                className="max-w-full truncate rounded-full border border-[var(--hair-2)] bg-surface px-2.5 py-1 text-left text-[11px] leading-tight text-on-surface-muted transition-colors hover:border-[var(--hair-3)] hover:text-on-surface"
                title={`${source.title}\n${source.url}${source.snippet ? `\n\n${source.snippet}` : ''}`}
              >
                <span className="font-semibold text-accent">{source.id}</span>
                <span className="mx-1 text-on-surface-muted/70">·</span>
                <span>{source.hostname || getSourceLabel(source.url)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        {!isStreaming && !isUser && (
          <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-1.5">
            <button
              onClick={() => navigator.clipboard.writeText(message.content)}
              className="text-[10px] font-medium uppercase tracking-[0.08em] text-on-surface-muted transition-colors hover:text-on-surface"
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
