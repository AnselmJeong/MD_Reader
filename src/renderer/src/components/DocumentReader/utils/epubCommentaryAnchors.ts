import type { CommentaryAnchor } from '../../../../../shared/commentary'
import { commentaryText } from '../../../../../shared/commentary'

export const COMMENTARY_HOST = 'md-reader-notes'
export const COMMENTARY_BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, figcaption, td, th'

export function sourceAnchor(element: Element, chapterHref: string): CommentaryAnchor | null {
  const body = element.ownerDocument.body
  if (!body || !body.contains(element)) return null
  const path: number[] = []
  let current = element
  while (current !== body) {
    const parent = current.parentElement
    if (!parent) return null
    path.unshift(Array.from(parent.children).filter(child => child.localName !== COMMENTARY_HOST).indexOf(current))
    current = parent
  }
  return { chapterHref: chapterHref.split('#')[0], path, quote: commentaryText(element.textContent ?? '').slice(0, 10000), elementId: element.id || undefined, tagName: element.localName }
}

export function resolveSourceAnchor(doc: Document, anchor: CommentaryAnchor): Element | null {
  let node: Element | undefined = doc.body
  for (const index of anchor.path) node = node && Array.from(node.children).filter(child => child.localName !== COMMENTARY_HOST)[index]
  const matches = (element: Element | null | undefined) => element && (!anchor.tagName || element.localName === anchor.tagName)
    && commentaryText(element.textContent ?? '').slice(0, 10000) === anchor.quote
  if (matches(node)) return node!
  const identified = anchor.elementId ? doc.getElementById(anchor.elementId) : null
  if (matches(identified)) return identified
  const candidates = Array.from(doc.body.querySelectorAll(COMMENTARY_BLOCKS)).filter(matches)
  return candidates.length === 1 ? candidates[0] : null
}
