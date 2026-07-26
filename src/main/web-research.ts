import type { ChatSource } from './ai-chat-types'

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'before', 'being', 'context', 'could', 'does', 'from',
  'have', 'into', 'more', 'most', 'other', 'question', 'reading', 'should', 'source',
  'than', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'user', 'what',
  'when', 'where', 'which', 'while', 'with', 'would',
  '관련', '그것', '그리고', '대한', '대해', '문서', '무엇', '어떤', '에서', '있는', '있었', '질문'
])

function researchTerms(...values: Array<string | undefined>): string[] {
  const terms = values
    .join(' ')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]{1,}/gu) ?? []

  return [...new Set(terms)]
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    .slice(0, 28)
}

function splitLongBlock(block: string, maxLength = 1100): string[] {
  if (block.length <= maxLength) return [block]
  const sentences = block.split(/(?<=[.!?。！？])\s+/u)
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxLength) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }

  if (current) chunks.push(current)
  return chunks.length ? chunks : [block.slice(0, maxLength)]
}

function contentBlocks(content: string): string[] {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!normalized) return []
  return normalized
    .split(/\n{2,}/)
    .flatMap((block) => splitLongBlock(block.trim()))
    .filter((block) => block.length >= 40)
}

function scoreBlock(block: string, terms: string[]): number {
  const lower = block.toLocaleLowerCase()
  let score = 0
  for (const term of terms) {
    const first = lower.indexOf(term)
    if (first < 0) continue
    score += 5
    const second = lower.indexOf(term, first + term.length)
    if (second >= 0) score += 2
  }
  if (/^#{1,4}\s/u.test(block)) score += 1
  return score
}

export function selectRelevantExcerpt(
  content: string,
  query: string,
  question: string,
  maxLength = 2400
): string {
  const blocks = contentBlocks(content)
  if (!blocks.length) return ''

  const terms = researchTerms(query, question)
  const ranked = blocks
    .map((block, index) => ({ block, index, score: scoreBlock(block, terms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const selected: string[] = []
  let length = 0
  const minimumRelevantScore = Math.max(1, ranked[0].score * 0.45)
  for (const candidate of ranked) {
    if (selected.length > 0 && candidate.score < minimumRelevantScore) break
    const remaining = maxLength - length - (selected.length ? 2 : 0)
    if (remaining < 80) break
    selected.push(candidate.block.slice(0, remaining))
    length += Math.min(candidate.block.length, remaining) + (selected.length > 1 ? 2 : 0)
  }

  if (!selected.length) return blocks[0].slice(0, maxLength)
  return selected.join('\n\n').slice(0, maxLength)
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.searchParams.sort()
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim().replace(/\/$/, '')
  }
}

export function mergeAndReindexSources(
  primary: ChatSource[],
  secondary: ChatSource[],
  maxSources = 8
): ChatSource[] {
  const merged: ChatSource[] = []
  const seen = new Set<string>()

  for (const source of [...primary, ...secondary]) {
    const key = canonicalUrl(source.url)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(source)
    if (merged.length >= maxSources) break
  }

  return merged.map((source, index) => ({ ...source, id: `S${index + 1}` }))
}
