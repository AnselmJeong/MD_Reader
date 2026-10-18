import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { normalizeMathDelimiters, remarkLegacyChatMath } from './chatMath'

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeCjkAdjacentEmphasis(content: string): string {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment) => {
      if (segment.startsWith('```') || segment.startsWith('`')) return segment
      return segment.replace(/(?<=[^*\s])(\*{1,3})(?=\p{Script=Hangul})/gu, '$1&#8203;')
    })
    .join('')
}

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function wrapTableNodes(node: HastNode) {
  if (!node.children) return

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]

    if (child.type === 'element' && child.tagName === 'table') {
      node.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['chat-table-scroll'] },
        children: [child]
      }
      continue
    }

    wrapTableNodes(child)
  }
}

function rehypeWrapChatTables() {
  return function transformer(tree: HastNode) {
    wrapTableNodes(tree)
  }
}

export function renderChatMarkdown(content: string, streaming: boolean): string {
  try {
    const normalizedContent = normalizeCjkAdjacentEmphasis(normalizeMathDelimiters(content))
    const result = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(remarkGfm)
      .use(remarkLegacyChatMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeHighlight, { detect: !streaming })
      .use(rehypeWrapChatTables)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(normalizedContent)
    return String(result)
  } catch {
    // During incomplete streaming markdown/math, keep content readable and safe.
    return escapeHtml(content).replace(/\n/g, '<br/>')
  }
}
