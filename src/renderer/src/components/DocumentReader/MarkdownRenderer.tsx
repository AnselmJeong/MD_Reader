import { memo, MouseEvent, useCallback, useMemo } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { extractMarkdownHeadings, stripMarkdownFrontmatter } from './utils/headings'

interface MarkdownRendererProps {
  content: string
}

function transformHighlightSyntax(content: string): string {
  // Keep code segments untouched while converting ==highlight== into <mark>.
  const codeSplit = content.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return codeSplit
    .map((segment) => {
      if (segment.startsWith('```') || segment.startsWith('`')) return segment
      return segment.replace(/==(?=\S)(.+?\S)==/g, '<mark>$1</mark>')
    })
    .join('')
}

function processCallouts(html: string): string {
  // Transform > [!type] Title patterns into styled callout divs
  return html.replace(
    /<blockquote>\s*<p>\[!(note|warning|important|definition|theorem|tip|caution|abstract)\](?:\s*(.+?))?\s*\n?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_match, type: string, title: string | undefined, body: string) => {
      const typeLower = type.toLowerCase()
      const icons: Record<string, string> = {
        note: 'ℹ️', warning: '⚠️', important: '❗', definition: '📖',
        theorem: '📐', tip: '💡', caution: '🔥', abstract: '📋'
      }
      const displayTitle = title?.trim() || type.charAt(0).toUpperCase() + type.slice(1)
      return `<div class="callout callout-${typeLower}">
        <div class="callout-title">${icons[typeLower] || '📌'} ${displayTitle}</div>
        <div>${body.trim()}</div>
      </div>`
    }
  )
}

function addHeadingIds(html: string, content: string): string {
  const headings = extractMarkdownHeadings(content)
  let headingIndex = 0

  return html.replace(/<h([1-4])(\s[^>]*)?>/g, (match, level: string, attributes = '') => {
    const heading = headings[headingIndex]
    if (!heading || heading.level !== Number(level)) return match

    headingIndex += 1
    if (/\sid=/.test(attributes)) return match

    return `<h${level}${attributes} id="${heading.id}">`
  })
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => {
    try {
      const stripped = stripMarkdownFrontmatter(content)
      const withHighlights = transformHighlightSyntax(stripped)
      const result = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml'])
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex)
        .use(rehypeHighlight, { detect: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(withHighlights)

      let htmlStr = String(result)
      htmlStr = addHeadingIds(htmlStr, content)
      htmlStr = processCallouts(htmlStr)
      return htmlStr
    } catch (error) {
      console.error('Markdown rendering error:', error)
      return `<p class="text-red-500">Failed to render document. ${error}</p>`
    }
  }, [content])

  const handleLinkClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('http://') && !href.startsWith('https://')) return

    event.preventDefault()
    void window.api.shell.openExternal(href)
  }, [])

  return <div onClick={handleLinkClick} dangerouslySetInnerHTML={{ __html: html }} />
})
