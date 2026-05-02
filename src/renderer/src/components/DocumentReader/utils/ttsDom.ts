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

export function markSpokenText(root: HTMLElement, scrollContainer: HTMLElement | null, spokenText: string): HTMLElement | null {
  clearTtsMarks(root)

  const needle = normalizeForMatch(spokenText)
  if (!needle) return null

  const nodes = getTextNodes(root)
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
