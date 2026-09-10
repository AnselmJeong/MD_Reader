import { useEffect, useRef, useState } from 'react'
import { useDocumentStore, type MarkdownDocumentTab } from '../store/useDocumentStore'

export function BibliographyControl({ tab }: { tab: MarkdownDocumentTab }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const updateBibliography = useDocumentStore((state) => state.updateBibliography)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const changeBibliography = async (reset: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const result = reset
        ? await window.api.file.resetBibliography(tab.filePath)
        : await window.api.file.selectBibliography(tab.filePath)
      if (result) updateBibliography(tab.id, result)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load bibliography.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Bibliography for this document"
        className="rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium text-on-surface hover:bg-[var(--ink-3)]"
      >
        Bib{tab.customBibFilePath ? ' · Custom' : ''}{tab.bibError ? ' !' : ''}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-surface-alt p-3 text-xs text-on-surface shadow-lg">
          <p className="font-semibold">Bibliography</p>
          <p className="mt-1 text-on-surface-muted">
            {tab.customBibFilePath ? 'Custom file · saved for this document' : 'Automatic · same name first, then a sibling .bib file'}
          </p>
          <p className="mt-2 break-all select-text">{tab.bibFilePath || 'No bibliography found.'}</p>
          {(error || tab.bibError) && <p role="alert" className="mt-2 break-words text-red-500">{error || tab.bibError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void changeBibliography(false)} className="rounded border border-border px-2 py-1.5 hover:bg-surface disabled:opacity-40">
              {busy ? 'Loading…' : 'Choose .bib file…'}
            </button>
            {tab.customBibFilePath && (
              <button disabled={busy} onClick={() => void changeBibliography(true)} className="rounded px-2 py-1.5 hover:bg-surface disabled:opacity-40">
                Use automatic
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
