import type { Contents } from 'epubjs'
import { normalizeCoachText } from '../../../../../shared/coach'
import { COMMENTARY_BLOCKS, COMMENTARY_HOST } from './epubCommentaryAnchors'

// Coach marks use the CSS Custom Highlight API: ranges are registered and painted
// without inserting elements, so EPUB CFIs, highlights and commentary anchors
// (which rely on DOM paths) are unaffected.
const HIGHLIGHT_NAME = 'md-reader-coach'
const STYLE_ID = 'md-reader-coach-style'

/** `occurrence`: which match of the quote to mark (0 = first). A card made from a selection marks
 * the words where the reader selected them, not wherever they first appear in the chapter. */
export interface CoachMarkEntry { cardId: string; quote: string; occurrence?: number }
interface Registered { cardId: string; range: Range }
const registry = new WeakMap<Document, Registered[]>()

type HighlightWindow = Window & {
  CSS?: { highlights?: Map<string, unknown> }
  Highlight?: new (...ranges: Range[]) => unknown
}

const SKIP = new Set(['script', 'style', 'noscript', COMMENTARY_HOST])

/** Whitespace is ignored when matching: line breaks (<br>) and block boundaries put spaces in a
 * selection or a model quote that the text nodes do not have, and vice versa. */
const compact = (text: string) => normalizeCoachText(text).replace(/\s+/g, '')

/** Normalized text of the chapter body, without whitespace, with a map back to text-node offsets. (Also used to line up 2D and 3D positions.) */
export function indexText(doc: Document) {
  let text = ''
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let parent = node.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
        if (SKIP.has(parent.localName)) return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const positions: Array<{ node: Text; offset: number }> = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data
    for (let index = 0; index < value.length; index += 1) {
      const char = compact(value[index])
      if (!char) continue
      text += char
      positions.push({ node, offset: index })
    }
  }
  return { text, positions }
}

export function findQuoteRanges(doc: Document, entries: CoachMarkEntry[]): Registered[] {
  if (!doc.body) return []
  const { text, positions } = indexText(doc)
  const result: Registered[] = []
  for (const entry of entries) {
    const needle = compact(entry.quote)
    if (needle.length < 2) continue
    let start = text.indexOf(needle)
    if (start < 0) continue
    for (let n = entry.occurrence ?? 0; n > 0; n -= 1) {
      const next = text.indexOf(needle, start + 1)
      if (next < 0) break
      start = next
    }
    const first = positions[start]
    const last = positions[start + needle.length - 1]
    if (!first || !last) continue
    const range = doc.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset + 1)
    result.push({ cardId: entry.cardId, range })
  }
  return result
}

/** Coach marks get their own blue-teal, distinct from the app accent and from the reader's own highlights. */
export function coachMarkColor(theme: string): string {
  if (theme === 'dark') return 'oklch(0.76 0.11 215)'
  if (theme === 'sepia') return 'oklch(0.52 0.11 210)'
  return 'oklch(0.55 0.13 235)'
}

export function coachHighlightSupported(contents: Contents): boolean {
  const win = contents.window as HighlightWindow
  return Boolean(win.CSS?.highlights && win.Highlight)
}

/** Replace the coach marks in one rendered chapter. Returns the number of marks painted. */
export function setCoachMarks(contents: Contents, entries: CoachMarkEntry[], color: string): number {
  const doc = contents.document
  const win = contents.window as HighlightWindow
  if (!doc?.body || !win.CSS?.highlights || !win.Highlight) { registry.set(doc, []); return 0 }
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = STYLE_ID
    doc.head.appendChild(style)
  }
  // Only the dotted underline is coloured; the words themselves are left as they are.
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-thickness: 2px; text-decoration-color: ${color}; text-underline-offset: 3px; }`
  const ranges = findQuoteRanges(doc, entries)
  registry.set(doc, ranges)
  if (ranges.length) win.CSS.highlights.set(HIGHLIGHT_NAME, new win.Highlight(...ranges.map(item => item.range)))
  else win.CSS.highlights.delete(HIGHLIGHT_NAME)
  return ranges.length
}

const blockOf = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest(COMMENTARY_BLOCKS) ?? null

/** The paragraph that contains a card's quote, for anchors and "더 자세히". */
export function coachQuoteBlock(doc: Document, quote: string, occurrence?: number): Element | null {
  const [found] = findQuoteRanges(doc, [{ cardId: '', quote, occurrence }])
  return found ? blockOf(found.range.startContainer) : null
}

/** Which match of `quote` in the document the reader's selection is (0 = first), and its paragraph. */
export function selectionOccurrence(doc: Document, quote: string, selection: Range | null): { occurrence: number; block: Element | null } {
  const needle = compact(quote)
  if (!doc.body || !selection || needle.length < 2) return { occurrence: 0, block: selection ? blockOf(selection.startContainer) : null }
  const { text, positions } = indexText(doc)
  let occurrence = 0
  for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + 1)) {
    const end = positions[start + needle.length - 1]
    // The first match that does not end before the selection starts is the one selected.
    if (end && selection.comparePoint(end.node, end.offset) >= 0) return { occurrence, block: blockOf(selection.startContainer) }
    occurrence += 1
  }
  return { occurrence: 0, block: blockOf(selection.startContainer) }
}

/** Report which mark the pointer is over, in outer-window coordinates. */
export function attachCoachHover(contents: Contents, onHover: (hit: { cardId: string; rect: DOMRect } | null) => void): () => void {
  const doc = contents.document
  let frame = 0
  let current: string | null = null
  let last: PointerEvent | null = null
  const check = () => {
    frame = 0
    const event = last
    if (!event) return
    const marks = registry.get(doc) ?? []
    for (const mark of marks) {
      for (const rect of Array.from(mark.range.getClientRects())) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2) {
          if (current === mark.cardId) return
          current = mark.cardId
          const origin = (contents.window.frameElement as HTMLElement | null)?.getBoundingClientRect()
          if (!origin) return
          onHover({ cardId: mark.cardId, rect: new DOMRect(origin.left + rect.left, origin.top + rect.top, rect.width, rect.height) })
          return
        }
      }
    }
    if (current !== null) { current = null; onHover(null) }
  }
  const move = (event: PointerEvent) => { last = event; if (!frame) frame = contents.window.requestAnimationFrame(check) }
  const leave = () => { if (current !== null) { current = null; onHover(null) } }
  doc.addEventListener('pointermove', move)
  doc.documentElement.addEventListener('pointerleave', leave)
  return () => {
    if (frame) contents.window.cancelAnimationFrame(frame)
    doc.removeEventListener('pointermove', move)
    doc.documentElement.removeEventListener('pointerleave', leave)
  }
}
