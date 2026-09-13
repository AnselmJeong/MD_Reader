import { splitFrontmatter } from '../../../../../shared/document-metadata'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { remarkKoreanStrong } from './remarkKoreanStrong'
import { prepareQuartoSource, remarkQuarto } from './remarkQuarto'
import type { Root, RootContent } from 'mdast'

export interface DocumentHeading {
  level: number
  text: string
  id: string
}

export function stripMarkdownFrontmatter(content: string): string {
  return splitFrontmatter(content).body
}

export function createHeadingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function getUniqueSlug(baseSlug: string, seen: Map<string, number>): string {
  const fallbackSlug = baseSlug || 'section'
  const count = seen.get(fallbackSlug) ?? 0
  seen.set(fallbackSlug, count + 1)
  return count === 0 ? fallbackSlug : `${fallbackSlug}-${count + 1}`
}

function cleanMarkdownHeadingText(text: string): string {
  return text
    .replace(/\s+#+\s*$/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

export function extractMarkdownHeadings(content: string, maxLevel = 4): DocumentHeading[] {
  const lines = stripMarkdownFrontmatter(content).split('\n')
  const headings: DocumentHeading[] = []
  const seen = new Map<string, number>()
  let inCodeBlock = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (!match) continue

    const level = match[1].length
    if (level > maxLevel) continue

    const text = cleanMarkdownHeadingText(match[2])
    const id = getUniqueSlug(createHeadingSlug(text), seen)
    headings.push({ level, text, id })
  }

  return headings
}

export function extractQuartoHeadings(content: string, maxLevel = 4): DocumentHeading[] {
  const processor = unified().use(remarkParse).use(remarkKoreanStrong).use(remarkGfm).use(remarkMath).use(remarkQuarto)
  const tree = processor.runSync(processor.parse(prepareQuartoSource(stripMarkdownFrontmatter(content)))) as Root
  const headings: DocumentHeading[] = []
  const nodeText = (node: RootContent): string => 'value' in node ? node.value : 'children' in node ? node.children.map(nodeText).join('') : ''
  const visit = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (node.type === 'heading' && node.depth <= maxLevel) headings.push({ level: node.depth, text: nodeText(node), id: String(node.data?.hProperties?.id) })
      if ('children' in node) visit(node.children)
    }
  }
  visit(tree.children)
  return headings
}
