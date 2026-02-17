import { useSettingsStore } from '../store/useSettingsStore'
import { useUIStore } from '../store/useUIStore'

interface ToolbarProps {
  onOpenFile: () => void
}

const themeIcons: Record<string, string> = {
  light: '☀️',
  sepia: '📜',
  dark: '🌙'
}

export function Toolbar({ onOpenFile }: ToolbarProps) {
  const { theme, fontSize, setFontSize, cycleTheme } = useSettingsStore()
  const { toggleToC, toggleSearch, toggleChat, showChat, toggleSettings } = useUIStore()

  return (
    <div className="titlebar-drag flex items-center h-11 px-4 bg-surface-alt border-b border-border ui-text select-none"
         style={{ paddingLeft: '80px' /* macOS traffic lights */ }}>
      {/* File actions */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={onOpenFile}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface"
          title="Open File (⌘O)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
          </svg>
          <span className="text-xs">Open</span>
        </button>
      </div>

      <div className="w-px h-5 bg-border mx-2" />

      {/* Navigation */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={toggleToC}
          className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface text-xs"
          title="Table of Contents (⌘⇧T)"
        >
          ToC
        </button>
        <button
          onClick={toggleSearch}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface"
          title="Search (⌘F)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </button>
      </div>

      <div className="w-px h-5 bg-border mx-2" />

      {/* Font size */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => setFontSize(fontSize - 1)}
          className="px-2 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface text-xs font-medium"
          title="Decrease font size (⌘-)"
        >
          A-
        </button>
        <span className="text-xs text-on-surface-muted w-8 text-center">{fontSize}</span>
        <button
          onClick={() => setFontSize(fontSize + 1)}
          className="px-2 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface text-xs font-medium"
          title="Increase font size (⌘+)"
        >
          A+
        </button>
      </div>

      <div className="w-px h-5 bg-border mx-2" />

      {/* Theme */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={cycleTheme}
          className="px-2.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface text-xs"
          title="Cycle Theme (⌘⇧D)"
        >
          {themeIcons[theme]} {theme.charAt(0).toUpperCase() + theme.slice(1)}
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={toggleChat}
          className={`px-2.5 py-1 rounded-md transition-colors text-xs ${
            showChat
              ? 'bg-accent text-white'
              : 'hover:bg-surface text-on-surface-muted hover:text-on-surface'
          }`}
          title="Toggle Chat (⌘/)"
        >
          AI Chat
        </button>
        <button
          onClick={toggleSettings}
          className="px-2 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface"
          title="Settings"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
