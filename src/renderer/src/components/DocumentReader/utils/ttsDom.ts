import { scrollMatchIntoView } from './searchDom'

export const TTS_CURRENT_CLASS = 'md-tts-current'

export function clearTtsMarks(root: HTMLElement) {
  const marks = root.querySelectorAll(`mark.${TTS_CURRENT_CLASS}`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  })
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function normalizeChar(value: string): string {
  return /\s/.test(value) ? ' ' : value.toLocaleLowerCase()
}

function getTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue || ''
      if (!value.trim()) return NodeFilter.FILTER_REJECT
      if (!node.parentElement) return NodeFilter.FILTER_REJECT
      if (node.parentElement.closest('script, style, mark.md-search-match')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

interface TextPosition {
  node: Text
  offset: number
}

function buildNormalizedTextMap(nodes: Text[]): { text: string; positions: TextPosition[] } {
  let text = ''
  const positions: TextPosition[] = []
  let previousWasSpace = true

  for (const node of nodes) {
    const raw = node.nodeValue || ''
    for (let offset = 0; offset < raw.length; offset++) {
      const char = normalizeChar(raw[offset])
      if (char === ' ') {
        if (previousWasSpace) continue
        previousWasSpace = true
      } else {
        previousWasSpace = false
      }
      text += char
      positions.push({ node, offset })
    }
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    positions.pop()
  }

  return { text, positions }
}

function markRange(root: HTMLElement, scrollContainer: HTMLElement | null, start: TextPosition, end: TextPosition): HTMLElement | null {
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  const mark = document.createElement('mark')
  mark.className = TTS_CURRENT_CLASS
  try {
    range.surroundContents(mark)
  } catch {
    clearTtsMarks(root)
    return null
  }
  scrollMatchIntoView(scrollContainer, mark)
  return mark
}

function markAcrossTextNodes(root: HTMLElement, scrollContainer: HTMLElement | null, spokenText: string): HTMLElement | null {
  const needle = normalizeForMatch(spokenText)
  if (!needle) return null

  const nodes = getTextNodes(root)
  const mapped = buildNormalizedTextMap(nodes)
  const mappedIndex = mapped.text.indexOf(needle)
  if (mappedIndex >= 0) {
    const start = mapped.positions[mappedIndex]
    const end = mapped.positions[Math.min(mappedIndex + needle.length - 1, mapped.positions.length - 1)]
    if (start && end) return markRange(root, scrollContainer, start, end)
  }

  for (const node of nodes) {
    const raw = node.nodeValue || ''
    const haystack = normalizeForMatch(raw)
    const index = haystack.indexOf(needle)
    if (index < 0) continue

    const rawLower = raw.toLocaleLowerCase()
    const compactNeedle = spokenText.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    const directIndex = rawLower.indexOf(compactNeedle)
    const start = directIndex >= 0 ? directIndex : Math.min(index, raw.length)
    const end = Math.min(raw.length, start + (directIndex >= 0 ? compactNeedle.length : spokenText.length))

    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, Math.max(start, end))
    const mark = document.createElement('mark')
    mark.className = TTS_CURRENT_CLASS
    try {
      range.surroundContents(mark)
    } catch {
      clearTtsMarks(root)
      return null
    }
    scrollMatchIntoView(scrollContainer, mark)
    return mark
  }

  const firstWords = needle.split(' ').slice(0, 8).join(' ')
  if (firstWords && firstWords !== needle) {
    return markSpokenText(root, scrollContainer, firstWords)
  }

  return null
}

export function markSpokenText(root: HTMLElement, scrollContainer: HTMLElement | null, spokenText: string): HTMLElement | null {
  clearTtsMarks(root)
  return markAcrossTextNodes(root, scrollContainer, spokenText)
}
