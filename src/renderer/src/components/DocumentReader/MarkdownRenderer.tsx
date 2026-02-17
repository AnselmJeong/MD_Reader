import { useMemo } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'

interface MarkdownRendererProps {
  content: string
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  return match ? content.slice(match[0].length) : content
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

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => {
    try {
      const stripped = stripFrontmatter(content)
      const result = unified()
        .use(remarkParse)
        .use(remarkFrontmatter, ['yaml'])
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex)
        .use(rehypeHighlight, { detect: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(stripped)

      let htmlStr = String(result)
      htmlStr = processCallouts(htmlStr)
      return htmlStr
    } catch (error) {
      console.error('Markdown rendering error:', error)
      return `<p class="text-red-500">Failed to render document. ${error}</p>`
    }
  }, [content])

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
