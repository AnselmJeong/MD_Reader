import { EpubCFI } from 'epubjs'
import { indexText } from './epubCoachMarks'

// 2D (epub.js) keeps the reading position as a CFI; 3D as a page of its own layout. Both are
// lined up through the chapter's whitespace-free text: the CFI is resolved in the chapter's own
// XHTML, turned into a character offset, and that offset is found again in the 3D layout (and back).

type TextIndex = ReturnType<typeof indexText>

const indexCache = new WeakMap<Document, TextIndex>()
export function chapterTextIndex(doc: Document): TextIndex {
  let index = indexCache.get(doc)
  if (!index) {
    index = indexText(doc)
    indexCache.set(doc, index)
  }
  return index
}

/** Offset (in whitespace-free text) of a CFI's start within the chapter document, or null. */
export function compactOffsetOfCfi(doc: Document, cfi: string): number | null {
  if (!doc.body || !cfi) return null
  let range: Range | null = null
  try { range = new EpubCFI(cfi).toRange(doc) } catch { return null }
  if (!range) return null
  const { positions } = chapterTextIndex(doc)
  const start = doc.createRange()
  try {
    start.setStart(range.startContainer, range.startOffset)
    start.collapse(true)
  } catch { return null }
  // First character at or after the CFI's start.
  let low = 0
  let high = positions.length
  while (low < high) {
    const mid = (low + high) >> 1
    let before = false
    try { before = start.comparePoint(positions[mid].node, positions[mid].offset) < 0 } catch { return null }
    if (before) low = mid + 1
    else high = mid
  }
  return low
}

/** A CFI (as epub.js would make it) for a character offset in the chapter document. */
export function cfiForCompactOffset(doc: Document, offset: number, cfiBase: string): string | null {
  const { positions } = chapterTextIndex(doc)
  const position = positions[Math.max(0, Math.min(positions.length - 1, offset))]
  if (!position) return null
  try {
    const range = doc.createRange()
    range.setStart(position.node, position.offset)
    range.collapse(true)
    return new EpubCFI(range, cfiBase).toString()
  } catch {
    return null
  }
}

/**
 * Map an offset in one version of a chapter's text to the other. The texts are nearly the same
 * (3D drops some captions and joins table cells), so the words at the offset are looked up and
 * the match nearest the proportional position wins; failing that, the proportional position.
 */
export function mapCompactOffset(fromText: string, toText: string, offset: number): number {
  if (!toText.length) return 0
  const clamped = Math.max(0, Math.min(fromText.length, offset))
  const expected = fromText.length ? Math.round((clamped / fromText.length) * toText.length) : 0
  for (const size of [32, 16, 8]) {
    const snippet = fromText.slice(clamped, clamped + size)
    if (snippet.length < Math.min(size, 6)) continue
    let best = -1
    for (let at = toText.indexOf(snippet); at >= 0; at = toText.indexOf(snippet, at + 1)) {
      if (best < 0 || Math.abs(at - expected) < Math.abs(best - expected)) best = at
    }
    if (best >= 0) return best
  }
  return Math.max(0, Math.min(toText.length - 1, expected))
}
