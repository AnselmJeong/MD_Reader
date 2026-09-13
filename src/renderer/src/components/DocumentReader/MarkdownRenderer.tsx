import { prepareQuartoSource, remarkQuarto } from './utils/remarkQuarto'
import { memo, MouseEvent, useCallback, useMemo, useEffect, useRef } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkKoreanStrong } from './utils/remarkKoreanStrong'
import { remarkCitations } from './utils/remarkCitations'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { extractMarkdownHeadings, stripMarkdownFrontmatter } from './utils/headings'

interface MarkdownRendererProps {
  filePath?: string
  quarto?: boolean
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
      const displayTitle = title?.trim() || type.charAt(0).toUpperCase() + type.slice(1)
      return `<div class="callout callout-${typeLower}">
        <div class="callout-title">${displayTitle}</div>
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

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, filePath, quarto = false }: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    try {
      const stripped = stripMarkdownFrontmatter(content)
      const withHighlights = quarto ? prepareQuartoSource(stripped) : transformHighlightSyntax(stripped)
      const processor = unified()
        .use(remarkParse)
        .use(remarkKoreanStrong)
        .use(remarkFrontmatter, ['yaml'])
        .use(remarkMath)
        .use(remarkGfm)
      if (quarto) processor.use(remarkQuarto)
      const result = processor
        .use(remarkCitations)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex)
        .use(rehypeHighlight, { detect: true })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .processSync(withHighlights)

      let htmlStr = String(result)
      if (!quarto) htmlStr = addHeadingIds(htmlStr, content)
      htmlStr = processCallouts(htmlStr)
      return htmlStr
    } catch (error) {
      console.error('Markdown rendering error:', error)
      return `<p class="text-red-500">Failed to render document. ${error}</p>`
    }
  }, [content, quarto])

  useEffect(() => {
    if (!quarto || !filePath) return
    let canceled = false
    const root = rootRef.current
    for (const img of root?.querySelectorAll('img') ?? []) {
      const source = img.dataset.documentSource ?? img.getAttribute('src') ?? ''
      if (!source || /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) continue
      img.dataset.documentSource = source
      img.removeAttribute('src')
      void window.api.file.readImage(filePath, source).then(data => {
        if (canceled) return
        if (data) img.src = data
        else { img.alt = img.alt || source; img.title = `그림을 읽을 수 없습니다: ${source}` }
      }).catch(() => { if (!canceled) img.title = `그림을 읽을 수 없습니다: ${source}` })
    }
    return () => { canceled = true }
  }, [html, quarto, filePath])

  const handleLinkClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      event.preventDefault()
      try {
        const id = decodeURIComponent(href.slice(1))
        const destination = Array.from(rootRef.current?.querySelectorAll('[id]') ?? []).find(node => node.id === id)
        destination?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch { /* An invalid fragment should not navigate away from the reader. */ }
      return
    }
    if (!href.startsWith('http://') && !href.startsWith('https://')) return

    event.preventDefault()
    void window.api.shell.openExternal(href)
  }, [])

  return <div key={filePath} ref={rootRef} onClick={handleLinkClick} dangerouslySetInnerHTML={{ __html: html }} />
})
