export interface DocumentHeading {
  level: number
  text: string
  id: string
}

export function stripMarkdownFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  return match ? content.slice(match[0].length) : content
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

