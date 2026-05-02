import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import {
  clearSearchMarks,
  collectSearchMatches,
  scrollMatchIntoView,
  SEARCH_MATCH_ACTIVE_CLASS
} from '../utils/searchDom'

interface UseDocumentSearchOptions {
  content: string | null
  rootRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  showSearch: boolean
  setShowSearch: (show: boolean) => void
}

export function useDocumentSearch({
  content,
  rootRef,
  scrollRef,
  showSearch,
  setShowSearch
}: UseDocumentSearchOptions) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchMatchesRef = useRef<HTMLElement[]>([])
  const activeMatchIndexRef = useRef(-1)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResultCount, setSearchResultCount] = useState(0)
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1)

  const setActiveMatch = useCallback((index: number, shouldScroll: boolean) => {
    const matches = searchMatchesRef.current
    if (!matches.length) {
      activeMatchIndexRef.current = -1
      setActiveSearchIndex(-1)
      return
    }

    const normalized = (index + matches.length) % matches.length
    matches.forEach((match, matchIndex) => {
      match.classList.toggle(SEARCH_MATCH_ACTIVE_CLASS, matchIndex === normalized)
    })

    activeMatchIndexRef.current = normalized
    setActiveSearchIndex(normalized)

    if (shouldScroll) {
      scrollMatchIntoView(scrollRef.current, matches[normalized])
    }
  }, [scrollRef])

  const goToNextMatch = useCallback(() => {
    if (!searchMatchesRef.current.length) return
    const nextIndex = activeMatchIndexRef.current >= 0 ? activeMatchIndexRef.current + 1 : 0
    setActiveMatch(nextIndex, true)
  }, [setActiveMatch])

  const goToPreviousMatch = useCallback(() => {
    if (!searchMatchesRef.current.length) return
    const prevIndex =
      activeMatchIndexRef.current >= 0 ? activeMatchIndexRef.current - 1 : searchMatchesRef.current.length - 1
    setActiveMatch(prevIndex, true)
  }, [setActiveMatch])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    clearSearchMarks(root)
    searchMatchesRef.current = []
    activeMatchIndexRef.current = -1
    setSearchResultCount(0)
    setActiveSearchIndex(-1)

    const matches = collectSearchMatches(root, searchQuery)
    searchMatchesRef.current = matches
    setSearchResultCount(matches.length)

    if (matches.length > 0) {
      setActiveMatch(0, true)
    }
  }, [content, rootRef, searchQuery, setActiveMatch])

  useEffect(() => {
    if (!showSearch) return
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [showSearch])

  useEffect(() => {
    const handleSearchHotkeys = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault()
        if (event.shiftKey) {
          goToPreviousMatch()
        } else {
          goToNextMatch()
        }
        return
      }

      if (!showSearch) return

      if (event.key === 'Escape') {
        event.preventDefault()
        setShowSearch(false)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) {
          goToPreviousMatch()
        } else {
          goToNextMatch()
        }
      }
    }

    window.addEventListener('keydown', handleSearchHotkeys)
    return () => window.removeEventListener('keydown', handleSearchHotkeys)
  }, [goToNextMatch, goToPreviousMatch, setShowSearch, showSearch])

  return {
    activeSearchIndex,
    goToNextMatch,
    goToPreviousMatch,
    searchInputRef,
    searchQuery,
    searchResultCount,
    setSearchQuery
  }
}
