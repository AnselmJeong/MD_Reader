import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'

interface HtmlNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HtmlNode[]
}

// Only imported image assets are rendered. Raw HTML is discarded by remark-rehype.
// This renderer is shared by the preview, inline notes and EPUB export.
export function renderCommentary(markdown: string, assets: Record<string, string>, mathml = false): string {
  const safeResources = () => (tree: HtmlNode) => {
    const visit = (node: HtmlNode) => {
      if (node.tagName === 'img' && node.properties) {
        const id = String(node.properties.src ?? '').replace(/^mdr-asset:/, '')
        if (assets[id]) node.properties.src = assets[id]
        else { node.tagName = 'span'; node.children = [{ type: 'text', value: `[그림: ${node.properties.alt || '첨부 필요'}]` }]; node.properties = {} }
      }
      if (node.tagName === 'a' && node.properties && !/^(https?:\/\/|#)/i.test(String(node.properties.href ?? ''))) {
        delete node.properties.href
      }
      node.children?.forEach(visit)
      if (node.children) node.children = node.children.map(child => child.tagName === 'table'
        ? { type: 'element', tagName: 'div', properties: { className: ['commentary-table-scroll'] }, children: [child] }
        : child)
    }
    visit(tree)
  }
  const normalized = markdown.split(/(`{3,}[^\n]*\n[\s\S]*?`{3,}|~{3,}[^\n]*\n[\s\S]*?~{3,}|`+[^`]*`+)/g)
    .map(part => /^[`~]/.test(part) ? part : part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`)
      .replace(/\\\(([^\n]*?)\\\)/g, (_match, math: string) => `$${math}$`)).join('')
  return String(unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex, { trust: false, output: mathml ? 'mathml' : 'htmlAndMathml' })
    .use(safeResources).use(rehypeStringify, { closeSelfClosing: true }).processSync(normalized))
}

export const commentaryCss = `
  .commentary-prose { overflow-wrap: break-word; font-size: 16px; line-height: 1.7; }
  .commentary-prose > :first-child { margin-top: 0; }
  .commentary-prose > :last-child { margin-bottom: 0; }
  .commentary-prose p { margin: .65em 0; }
  .commentary-prose img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
  .commentary-prose pre { overflow: auto; padding: .8em; background: color-mix(in srgb, currentColor 5%, transparent); }
  .commentary-prose .katex-display { overflow-x: auto; overflow-y: hidden; padding: .3em 0; }
  .commentary-table-scroll { max-width:100%; overflow:auto; margin:1em 0; }
  .commentary-prose table { width: 100%; border-collapse: collapse; border-top: 2px solid; border-bottom: 2px solid; }
  .commentary-prose th, .commentary-prose td { min-width: 7em; padding: .55em .75em; text-align: start; vertical-align: top; word-break: normal; }
  .commentary-prose thead th { border-bottom: 1px solid; }
  .commentary-prose a { color: inherit; text-decoration: underline; }
`
