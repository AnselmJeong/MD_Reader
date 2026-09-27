import { BibliographyControl } from './BibliographyControl'
import { useUIStore } from '../store/useUIStore'
import { useDocumentStore } from '../store/useDocumentStore'

interface ToolbarProps {
  onOpenFile: () => void
  onSaveFile: () => void
  canSave: boolean
  isDirty: boolean
}

const iconPaths: Record<string, string[]> = {
  folder: ['M2.5 5.5h4.1l1.5 1.6h5.4v6.9h-11z'],
  save: ['M3.5 2.75h7.4l1.6 1.6v8.9h-9z', 'M5.5 2.75v3.5h5', 'M5.5 10.25h5'],
  toc: ['M5.5 4h8', 'M5.5 8h8', 'M5.5 12h8', 'M2.75 4h.5', 'M2.75 8h.5', 'M2.75 12h.5'],
  search: ['M7.2 12.2a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M10.8 10.8l3 3'],
  spark: ['M8 1.75l.9 3.35L12.25 6l-3.35.9L8 10.25l-.9-3.35L3.75 6l3.35-.9L8 1.75z'],
  cog: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M8 1.75v1.4', 'M8 12.85v1.4', 'M1.75 8h1.4', 'M12.85 8h1.4', 'M3.6 3.6l1 1', 'M11.4 11.4l1 1', 'M12.4 3.6l-1 1', 'M4.6 11.4l-1 1']
}

function Icon({ name, className = 'h-3.5 w-3.5' }: { name: keyof typeof iconPaths; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {iconPaths[name].map((d) => <path key={d} className="icon-stroke" d={d} />)}
    </svg>
  )
}

export function Toolbar({ onOpenFile, onSaveFile, canSave, isDirty }: ToolbarProps) {
  const { toggleSearch, toggleChat, showChat, toggleSettings } = useUIStore()
  const { activeTab, fileName, isDirty: documentIsDirty } = useDocumentStore()

  return (
    <div className="titlebar-drag flex h-[38px] items-center border-b border-border bg-surface-alt px-4 pl-[88px] ui-text select-none">
      {/* File actions */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={onOpenFile}
          className="flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium text-on-surface hover:bg-[var(--ink-3)]"
          title="Open File (⌘O)"
        >
          <Icon name="folder" />
          <span>Open</span>
        </button>
        <button
          onClick={onSaveFile}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium text-on-surface hover:bg-[var(--ink-3)] disabled:opacity-35 disabled:hover:bg-transparent"
          title="Save File (⌘S)"
        >
          <Icon name="save" />
          <span>Save{isDirty ? ' *' : ''}</span>
        </button>
        {activeTab?.kind === 'markdown' && <BibliographyControl key={activeTab.id} tab={activeTab} />}
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* Navigation */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={toggleSearch}
          className="flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-on-surface hover:bg-[var(--ink-3)]"
          title="Search (⌘F)"
        >
          <Icon name="search" />
        </button>
      </div>

      <div className="pointer-events-none mx-3 flex min-w-0 flex-1 justify-center px-2 text-[11.5px] font-medium text-on-surface-muted">
        {fileName ? (
          <span className="max-w-full truncate">
            <span className="text-on-surface">{fileName}</span>{documentIsDirty && <span> · edited</span>}
          </span>
        ) : null}
      </div>

      {/* Right side */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={toggleChat}
          className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            showChat
              ? 'bg-on-surface text-surface'
              : 'hover:bg-surface text-on-surface-muted hover:text-on-surface'
          }`}
          title="Toggle Chat (⌘/)"
        >
          <Icon name="spark" />
          <span>Ask AI</span>
        </button>
        <button
          onClick={toggleSettings}
          className="rounded-[5px] px-2 py-1 text-on-surface-muted transition-colors hover:bg-[var(--ink-3)] hover:text-on-surface"
          title="Settings"
        >
          <Icon name="cog" />
        </button>
      </div>
    </div>
  )
}
