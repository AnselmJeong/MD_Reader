import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useUIStore } from '../../store/useUIStore'

type ReaderIconName = 'contents' | 'focus' | 'sliders' | 'close'

const iconPaths: Record<ReaderIconName, string[]> = {
  contents: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  focus: ['M8 3H3v5', 'M16 3h5v5', 'M8 21H3v-5', 'M16 21h5v-5', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  sliders: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4'],
  close: ['M6 6l12 12', 'M18 6L6 18']
}

function ReaderIcon({ name }: { name: ReaderIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  )
}

interface ReadingPaneHeaderProps {
  label: string
  progress: number
  showToC: boolean
  onToggleFocusMode: () => void
  onToggleToC: () => void
}

export function ReadingPaneHeader({
  label,
  progress,
  showToC,
  onToggleFocusMode,
  onToggleToC
}: ReadingPaneHeaderProps) {
  const {
    focusMode,
    showReadingSettings,
    toggleReadingSettings
  } = useUIStore()
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100)

  return (
    <header className="reading-pane-header">
      <div className="reading-location">
        <button
          type="button"
          className={`reading-icon-button ${showToC ? 'active' : ''}`}
          onClick={onToggleToC}
          aria-pressed={showToC}
          aria-label="목차 열기"
          title="목차"
        >
          <ReaderIcon name="contents" />
        </button>
        <span className="reading-location-title">{label}</span>
        <span className="reading-location-separator" aria-hidden="true">/</span>
        <span className="reading-location-progress">{percentage}%</span>
      </div>

      <div className="reading-pane-actions">
        <button
          type="button"
          className={`reading-focus-button ${focusMode ? 'active' : ''}`}
          onClick={onToggleFocusMode}
          aria-pressed={focusMode}
          title="집중 모드 (F)"
        >
          <ReaderIcon name="focus" />
          <span>집중</span>
          {focusMode && <kbd>← · →</kbd>}
        </button>
        <button
          type="button"
          className={`reading-icon-button ${showReadingSettings ? 'active' : ''}`}
          onClick={toggleReadingSettings}
          aria-expanded={showReadingSettings}
          aria-controls="reading-senses-panel"
          aria-label="읽기 감각 조정"
          title="읽기 감각"
        >
          <ReaderIcon name="sliders" />
        </button>
      </div>
    </header>
  )
}

export function ReadingSensesPanel() {
  const {
    theme,
    fontSize,
    lineHeight,
    contentWidth,
    readerFontFamily,
    setTheme,
    setFontSize,
    setLineHeight,
    setContentWidth,
    setReaderFontFamily
  } = useSettingsStore()
  const { showReadingSettings, setShowReadingSettings } = useUIStore()
  const [koreanFonts, setKoreanFonts] = useState<string[]>([])
  const [fontListStatus, setFontListStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!showReadingSettings) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowReadingSettings(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setShowReadingSettings, showReadingSettings])

  useEffect(() => {
    if (!showReadingSettings) return

    let cancelled = false
    setFontListStatus('loading')
    void window.api.fonts.listKorean()
      .then((fontFamilies) => {
        if (cancelled) return
        setKoreanFonts(fontFamilies)
        setFontListStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to load Korean system fonts:', error)
        setFontListStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [showReadingSettings])

  if (!showReadingSettings) return null

  return (
    <>
      <button
        type="button"
        className="reading-senses-backdrop"
        onClick={() => setShowReadingSettings(false)}
        aria-label="읽기 감각 닫기"
      />
      <aside id="reading-senses-panel" className="reading-senses-panel" aria-label="읽기 감각">
        <header>
          <div>
            <span className="reading-senses-eyebrow">Reading texture</span>
            <h2>읽기 감각</h2>
          </div>
          <button
            type="button"
            className="reading-icon-button"
            onClick={() => setShowReadingSettings(false)}
            aria-label="읽기 감각 닫기"
          >
            <ReaderIcon name="close" />
          </button>
        </header>

        <div className="reading-senses-content">
          <label className="reading-setting">
            <span>
              <strong>본문 글꼴</strong>
              <output title={readerFontFamily || '기본 글꼴'}>
                {readerFontFamily || '기본'}
              </output>
            </span>
            <select
              className="reading-font-select"
              value={readerFontFamily}
              onChange={(event) => setReaderFontFamily(event.target.value)}
              style={{ fontFamily: readerFontFamily || undefined }}
              aria-label="한글 본문 글꼴"
            >
              <option value="">기본 글꼴</option>
              {fontListStatus === 'loading' && (
                <option disabled>한글 글꼴 불러오는 중…</option>
              )}
              {fontListStatus === 'error' && (
                <option disabled>글꼴 목록을 불러오지 못했습니다</option>
              )}
              {fontListStatus === 'ready' && koreanFonts.length === 0 && (
                <option disabled>설치된 한글 글꼴을 찾지 못했습니다</option>
              )}
              {koreanFonts.map((fontFamily) => (
                <option key={fontFamily} value={fontFamily} style={{ fontFamily }}>
                  {fontFamily}
                </option>
              ))}
            </select>
          </label>

          <label className="reading-setting">
            <span><strong>본문 크기</strong><output>{fontSize}px</output></span>
            <input
              type="range"
              min="14"
              max="22"
              step="1"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </label>

          <label className="reading-setting">
            <span><strong>행간</strong><output>{lineHeight.toFixed(2)}</output></span>
            <input
              type="range"
              min="1.5"
              max="2.2"
              step="0.05"
              value={lineHeight}
              onChange={(event) => setLineHeight(Number(event.target.value))}
            />
          </label>

          <label className="reading-setting">
            <span><strong>판면 너비</strong><output>{contentWidth}</output></span>
            <input
              type="range"
              min="52"
              max="82"
              step="2"
              value={contentWidth}
              onChange={(event) => setContentWidth(Number(event.target.value))}
            />
          </label>

          <section className="reading-setting">
            <span><strong>판면</strong><output>종이와 잉크</output></span>
            <div className="reading-theme-options" role="group" aria-label="읽기 테마">
              {([
                ['light', '상아지'],
                ['sepia', '황혼'],
                ['dark', '심야']
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={theme === value ? 'active' : ''}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <span className={`reading-theme-swatch ${value}`} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </>
  )
}

interface ReadingPaneFooterProps {
  progress: number
  detail?: string
}

export function ReadingPaneFooter({ progress, detail }: ReadingPaneFooterProps) {
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100)

  return (
    <footer className="reading-pane-footer">
      <div className="reading-footer-rule" aria-hidden="true">
        <span style={{ transform: `scaleX(${percentage / 100})` }} />
      </div>
      <span className="reading-footer-label">
        {percentage}%{detail ? ` · ${detail}` : ''}
      </span>
    </footer>
  )
}
