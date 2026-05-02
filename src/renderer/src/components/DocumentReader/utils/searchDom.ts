export const SEARCH_MATCH_CLASS = 'md-search-match'
export const SEARCH_MATCH_ACTIVE_CLASS = 'md-search-match-active'

export function clearSearchMarks(root: HTMLElement) {
  const marks = root.querySelectorAll(`mark.${SEARCH_MATCH_CLASS}`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  })
}

export function collectSearchMatches(root: HTMLElement, query: string): HTMLElement[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue || ''
      if (!value.trim()) return NodeFilter.FILTER_REJECT
      if (!node.parentElement) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  const matches: HTMLElement[] = []

  textNodes.forEach((textNode) => {
    const raw = textNode.nodeValue || ''
    const lowered = raw.toLocaleLowerCase()
    let cursor = 0
    let foundAt = lowered.indexOf(normalizedQuery, cursor)

    if (foundAt < 0) return

    const fragment = document.createDocumentFragment()

    while (foundAt >= 0) {
      if (foundAt > cursor) {
        fragment.appendChild(document.createTextNode(raw.slice(cursor, foundAt)))
      }

      const match = document.createElement('mark')
      match.className = SEARCH_MATCH_CLASS
      match.textContent = raw.slice(foundAt, foundAt + normalizedQuery.length)
      fragment.appendChild(match)
      matches.push(match)

      cursor = foundAt + normalizedQuery.length
      foundAt = lowered.indexOf(normalizedQuery, cursor)
    }

    if (cursor < raw.length) {
      fragment.appendChild(document.createTextNode(raw.slice(cursor)))
    }

    textNode.parentNode?.replaceChild(fragment, textNode)
  })

  return matches
}

export function scrollMatchIntoView(container: HTMLElement | null, match: HTMLElement) {
  if (!container) {
    match.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' })
    return
  }

  const containerRect = container.getBoundingClientRect()
  const matchRect = match.getBoundingClientRect()
  const nextTop =
    container.scrollTop +
    (matchRect.top - containerRect.top) -
    (container.clientHeight / 2) +
    (matchRect.height / 2)

  container.scrollTo({
    top: Math.max(0, nextTop),
    behavior: 'smooth'
  })
}
