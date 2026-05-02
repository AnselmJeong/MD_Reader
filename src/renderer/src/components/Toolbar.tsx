import { useState } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { useUIStore } from '../store/useUIStore'
import { useDocumentStore } from '../store/useDocumentStore'
import { useTtsStore } from '../store/useTtsStore'

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
  headphones: ['M2.75 8.5a5.25 5.25 0 0 1 10.5 0', 'M2.75 8.5v3.75h2v-4h-2z', 'M13.25 8.5v3.75h-2v-4h2z'],
  sun: ['M8 10.75A2.75 2.75 0 1 0 8 5.25a2.75 2.75 0 0 0 0 5.5z', 'M8 1.5v1.2', 'M8 13.3v1.2', 'M1.5 8h1.2', 'M13.3 8h1.2', 'M3.4 3.4l.85.85', 'M11.75 11.75l.85.85', 'M12.6 3.4l-.85.85', 'M4.25 11.75l-.85.85'],
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
  const [isTtsErrorOpen, setIsTtsErrorOpen] = useState(false)
  const { theme, fontSize, setFontSize, cycleTheme } = useSettingsStore()
  const { toggleToC, toggleSearch, toggleChat, showChat, toggleSettings } = useUIStore()
  const { content, fileName, isDirty: documentIsDirty } = useDocumentStore()
  const { mode: ttsMode, state: ttsState, error: ttsError, speakDocument, resume, stop, restart, clearError } = useTtsStore()
  const hasDocument = Boolean(content)
  const isDocumentTts = ttsMode === 'document'
  const isPreparingTts = ttsState === 'initializing' || ttsState === 'downloading-model'
  const isPlayingTts = isDocumentTts && ttsState === 'playing'
  const isPausedTts = isDocumentTts && ttsState === 'paused'

  const handleReadDocument = () => {
    if (!content || isPreparingTts) return
    void speakDocument(content)
  }

  const copyTtsError = async () => {
    if (!ttsError) return
    try {
      await navigator.clipboard.writeText(ttsError)
    } catch (error) {
      console.error('Failed to copy TTS error:', error)
    }
  }

  const dismissTtsError = () => {
    clearError()
    setIsTtsErrorOpen(false)
  }

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
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* Navigation */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={toggleToC}
          className="flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium text-on-surface hover:bg-[var(--ink-3)]"
          title="Table of Contents (⌘⇧T)"
        >
          <Icon name="toc" />
          <span>Contents</span>
        </button>
        <button
          onClick={toggleSearch}
          className="flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-on-surface hover:bg-[var(--ink-3)]"
          title="Search (⌘F)"
        >
          <Icon name="search" />
        </button>
        <button
          onClick={handleReadDocument}
          disabled={!hasDocument || isPreparingTts}
          className={`flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-on-surface transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
            isPlayingTts || isPausedTts ? 'bg-accent/15 text-accent' : 'hover:bg-surface'
          }`}
          title={
            !hasDocument
              ? 'Open a document to read'
              : isPreparingTts
                ? 'Preparing TTS'
                : isPlayingTts
                  ? 'Reading'
                  : isPausedTts
                    ? 'Resume reading'
                    : 'Read document'
          }
        >
          <Icon name="headphones" />
        </button>
        {isDocumentTts && (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              onClick={() => void resume()}
              disabled={ttsState !== 'stopped'}
              className="px-1.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface disabled:opacity-35 disabled:hover:bg-transparent"
              title="Play from current position"
            >
              ▶
            </button>
            <button
              onClick={() => void stop()}
              disabled={ttsState !== 'playing' && !isPreparingTts}
              className="px-1.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface"
              title="Stop"
            >
              ■
            </button>
            <button
              onClick={() => void restart()}
              className="px-1.5 py-1 rounded-md hover:bg-surface transition-colors text-on-surface-muted hover:text-on-surface"
              title="Rewind to beginning"
            >
              ↤
            </button>
          </>
        )}
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* Font size */}
      <div className="titlebar-no-drag flex items-center gap-0 rounded-md border border-border bg-surface">
        <button
          onClick={() => setFontSize(fontSize - 1)}
          className="px-2 py-1 text-[12px] font-medium text-on-surface-muted hover:text-on-surface"
          title="Decrease font size (⌘-)"
        >
          A-
        </button>
        <span className="w-8 border-x border-border text-center text-[12px] text-on-surface">{fontSize}</span>
        <button
          onClick={() => setFontSize(fontSize + 1)}
          className="px-2 py-1 text-[12px] font-medium text-on-surface-muted hover:text-on-surface"
          title="Increase font size (⌘+)"
        >
          A+
        </button>
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* Theme */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={cycleTheme}
          className="flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium text-on-surface hover:bg-[var(--ink-3)]"
          title="Cycle Theme (⌘⇧D)"
        >
          <Icon name="sun" />
          <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
        </button>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 max-w-[36vw] -translate-x-1/2 -translate-y-1/2 truncate text-[11.5px] font-medium text-on-surface-muted">
        {fileName ? (
          <><span className="text-on-surface">{fileName}</span>{documentIsDirty && <span> · edited</span>}</>
        ) : null}
      </div>

      <div className="flex-1" />

      {/* Right side */}
      <div className="titlebar-no-drag flex items-center gap-1">
        {ttsError && (
          <div className="relative">
            <button
              onClick={() => setIsTtsErrorOpen((open) => !open)}
              className="max-w-36 truncate rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/15"
              title="Show TTS error details"
            >
              TTS Error
            </button>
            {isTtsErrorOpen && (
              <div className="fixed right-4 top-12 z-50 flex max-h-[55vh] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-red-500/30 bg-surface-alt shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold text-red-500">TTS Error Details</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={copyTtsError}
                      className="rounded-md px-2 py-1 text-xs text-on-surface-muted hover:bg-surface hover:text-on-surface"
                    >
                      Copy
                    </button>
                    <button
                      onClick={dismissTtsError}
                      className="rounded-md px-2 py-1 text-xs text-on-surface-muted hover:bg-surface hover:text-on-surface"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => setIsTtsErrorOpen(false)}
                      className="rounded-md px-2 py-1 text-xs text-on-surface-muted hover:bg-surface hover:text-on-surface"
                      title="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap break-words overflow-auto p-3 text-left text-xs leading-relaxed text-on-surface">
                  {ttsError}
                </pre>
              </div>
            )}
          </div>
        )}
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
