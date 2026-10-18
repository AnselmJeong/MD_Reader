import { useDocumentStore } from '../store/useDocumentStore'

export function DocumentTabs({ onSelect }: { onSelect?: () => void }) {
  const { tabs, activeTabId, selectTab, closeTab } = useDocumentStore()

  if (tabs.length === 0) return null

  return (
    <div className="document-tabs flex h-10 items-end gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-surface-alt px-3 pt-1 ui-text">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`document-tab group flex h-9 max-w-[220px] shrink-0 items-center gap-2 border border-b-0 px-3 text-[11.5px] ${
              active
                ? 'border-border bg-surface text-on-surface'
                : 'border-transparent text-on-surface-muted hover:bg-[var(--ink-3)] hover:text-on-surface'
            }`}
          >
            <button
              onClick={() => { selectTab(tab.id); onSelect?.() }}
              className="min-w-0 flex-1 truncate text-left font-medium"
              title={tab.filePath}
            >
              {tab.fileName}{tab.isDirty ? ' *' : ''}
            </button>
            <button
              onClick={() => closeTab(tab.id)}
              className="rounded px-1 text-on-surface-muted opacity-60 transition-colors hover:bg-surface-alt hover:text-on-surface group-hover:opacity-100"
              title="Close tab" aria-label={`Close ${tab.fileName}`}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
