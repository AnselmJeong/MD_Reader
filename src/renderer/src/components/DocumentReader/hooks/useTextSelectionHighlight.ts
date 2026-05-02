import { RefObject, useCallback, useEffect, useState } from 'react'

function findNthOccurrence(content: string, selectedText: string, targetOccurrence: number): number {
  if (!selectedText || targetOccurrence < 0) return -1

  let from = 0
  let occurrence = 0

  while (from <= content.length) {
    const index = content.indexOf(selectedText, from)
    if (index < 0) return -1
    if (occurrence === targetOccurrence) return index
    occurrence += 1
    from = index + selectedText.length
  }

  return -1
}

function wrapTextWithHighlight(content: string, selectedText: string, occurrenceHint: number): string {
  if (!selectedText) return content

  let index = findNthOccurrence(content, selectedText, occurrenceHint)
  if (index < 0) {
    index = content.indexOf(selectedText)
  }
  if (index < 0) return content

  const before = content.slice(Math.max(0, index - 2), index)
  const after = content.slice(index + selectedText.length, index + selectedText.length + 2)
  if (before === '==' && after === '==') {
    return content
  }

  return `${content.slice(0, index)}==${selectedText}==${content.slice(index + selectedText.length)}`
}

function getVisibleSelectionRect(range: Range): DOMRect {
  const viewportTop = 0
  const viewportBottom = window.innerHeight
  const viewportLeft = 0
  const viewportRight = window.innerWidth
  const visibleRects = Array.from(range.getClientRects()).filter((rect) => (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewportTop &&
    rect.top < viewportBottom &&
    rect.right > viewportLeft &&
    rect.left < viewportRight
  ))

  if (visibleRects.length === 0) {
    return range.getBoundingClientRect()
  }

  const preferredRect = visibleRects.find((rect) => rect.top >= 56) ?? visibleRects[0]
  return DOMRect.fromRect({
    x: Math.max(viewportLeft, preferredRect.left),
    y: Math.max(viewportTop, preferredRect.top),
    width: Math.min(preferredRect.width, viewportRight - Math.max(viewportLeft, preferredRect.left)),
    height: preferredRect.height
  })
}

interface UseTextSelectionHighlightOptions {
  content: string | null
  rootRef: RefObject<HTMLElement | null>
  updateContent: (content: string) => void
}

export function useTextSelectionHighlight({
  content,
  rootRef,
  updateContent
}: UseTextSelectionHighlightOptions) {
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [selectedOccurrence, setSelectedOccurrence] = useState(0)

  const clearSelection = useCallback(() => {
    setSelectedText('')
    setSelectedOccurrence(0)
    setSelectionRect(null)
  }, [])

  const getSelectionOccurrence = useCallback((range: Range, text: string) => {
    const root = rootRef.current
    if (!root || !text) return 0

    const preRange = document.createRange()
    preRange.selectNodeContents(root)
    preRange.setEnd(range.startContainer, range.startOffset)

    const beforeSelection = preRange.toString()
    let from = 0
    let count = 0

    while (from <= beforeSelection.length) {
      const index = beforeSelection.indexOf(text, from)
      if (index < 0) break
      count += 1
      from = index + text.length
    }

    return count
  }, [rootRef])

  useEffect(() => {
    const handleSelection = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-selection-menu="true"]') || target?.closest('[data-search-panel="true"]')) {
        return
      }

      const root = rootRef.current
      const selection = window.getSelection()
      if (root && selection && selection.toString().trim() && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) {
          clearSelection()
          return
        }

        const normalizedSelection = selection.toString().trim()
        setSelectedText(normalizedSelection)
        setSelectedOccurrence(getSelectionOccurrence(range, normalizedSelection))
        setSelectionRect(getVisibleSelectionRect(range))
        return
      }

      clearSelection()
    }

    document.addEventListener('mouseup', handleSelection)
    return () => document.removeEventListener('mouseup', handleSelection)
  }, [clearSelection, getSelectionOccurrence, rootRef])

  const handleHighlightSelection = useCallback(() => {
    if (!content || !selectedText) return

    const nextContent = wrapTextWithHighlight(content, selectedText, selectedOccurrence)
    if (nextContent !== content) {
      updateContent(nextContent)
    }

    setSelectionRect(null)
  }, [content, selectedOccurrence, selectedText, updateContent])

  return {
    clearSelection,
    handleHighlightSelection,
    selectedText,
    selectionRect
  }
}
