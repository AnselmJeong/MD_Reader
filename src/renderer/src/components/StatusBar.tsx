import { useDocumentStore } from '../store/useDocumentStore'
import { useSettingsStore } from '../store/useSettingsStore'

export function StatusBar() {
  const { fileName, wordCount, readingTime } = useDocumentStore()
  const { fontSize, theme } = useSettingsStore()

  return (
    <div className="flex items-center justify-between h-6 px-4 bg-surface-alt border-t border-border ui-text text-[11px] text-on-surface-muted select-none">
      <div className="flex items-center gap-3">
        {fileName ? (
          <>
            <span className="font-medium text-on-surface">{fileName}</span>
            <span>{wordCount.toLocaleString()} words</span>
            <span>~{readingTime} min read</span>
          </>
        ) : (
          <span>No document open</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>{fontSize}px</span>
        <span className="capitalize">{theme}</span>
      </div>
    </div>
  )
}
