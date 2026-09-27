import { useDocumentStore } from '../store/useDocumentStore'
import { useSettingsStore } from '../store/useSettingsStore'

export function StatusBar() {
  const { fileName, kind, wordCount, readingTime, isDirty } = useDocumentStore()
  const { fontSize, theme } = useSettingsStore()
  return (
    <div className="small-caps flex h-6 items-center justify-between border-t border-border bg-surface-alt px-4 text-on-surface-muted select-none">
      <div className="flex min-w-0 items-center gap-2">
        {fileName ? (
          <>
            <span className="truncate text-on-surface">{fileName}</span>
            {isDirty && <span className="text-accent">Modified</span>}
            <span>·</span>
            {kind && (
              <>
                <span className="shrink-0">{/\.qmd$/i.test(fileName) ? 'QUARTO' : kind.toUpperCase()}</span>
                <span>·</span>
              </>
            )}
            <span className="shrink-0">{wordCount.toLocaleString()} Words</span>
            <span>·</span>
            <span className="shrink-0">≈ {readingTime} Min</span>
          </>
        ) : (
          <span className="shrink-0">No Document Open · Drop .MD, .QMD Or .EPUB To Begin</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span>{fontSize}px</span>
        <span>·</span>
        <span>{theme}</span>
      </div>
    </div>
  )
}
