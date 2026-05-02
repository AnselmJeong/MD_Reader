import { useDocumentStore } from '../store/useDocumentStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useTtsStore } from '../store/useTtsStore'

export function StatusBar() {
  const { fileName, wordCount, readingTime, isDirty } = useDocumentStore()
  const { fontSize, theme } = useSettingsStore()
  const { state: ttsState, message: ttsMessage, error: ttsError, activeUtteranceIndex, utterances } = useTtsStore()
  const showTtsStatus = !ttsError && !['idle', 'stopped', 'ended'].includes(ttsState)
  const ttsStatusText = showTtsStatus
    ? ttsMessage || (
        ttsState === 'initializing'
          ? 'Starting TTS...'
          : ttsState === 'downloading-model'
            ? 'Loading TTS model...'
            : ttsState === 'ready'
              ? 'TTS ready'
              : ttsState === 'playing'
                ? 'Reading...'
                : ttsState === 'paused'
                  ? 'TTS paused'
                  : ttsState
      )
    : null
  const utteranceProgress = ttsState === 'playing' && activeUtteranceIndex >= 0 && utterances.length > 0
    ? ` ${activeUtteranceIndex + 1}/${utterances.length}`
    : ''
  const visibleProgress = ttsStatusText && /\d+\/\d+/.test(ttsStatusText) ? '' : utteranceProgress

  return (
    <div className="small-caps flex h-6 items-center justify-between border-t border-border bg-surface-alt px-4 text-on-surface-muted select-none">
      <div className="flex min-w-0 items-center gap-2">
        {fileName ? (
          <>
            <span className="truncate text-on-surface">{fileName}</span>
            {isDirty && <span className="text-accent">Modified</span>}
            <span>·</span>
            <span className="shrink-0">{wordCount.toLocaleString()} Words</span>
            <span>·</span>
            <span className="shrink-0">≈ {readingTime} Min</span>
          </>
        ) : (
          <span className="shrink-0">No Document Open · Drop A .MD To Begin</span>
        )}
      </div>
      <div className="mx-4 flex min-w-0 flex-1 justify-center">
        {ttsStatusText && (
          <span className="truncate text-accent" title={ttsStatusText}>
            TTS: {ttsStatusText}{visibleProgress}
          </span>
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
