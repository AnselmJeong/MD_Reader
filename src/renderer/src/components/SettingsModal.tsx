import { useState, useEffect } from 'react'
import { TtsVoice, useSettingsStore } from '../store/useSettingsStore'
import { useChatStore } from '../store/useChatStore'
import { filterOllamaModels } from '../utils/ollama-model-filter'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    theme,
    fontSize,
    lineHeight,
    contentWidth,
    ttsVoice,
    setTheme,
    setFontSize,
    setLineHeight,
    setContentWidth,
    setTtsVoice
  } = useSettingsStore()
  const {
    systemPrompt,
    setSystemPrompt,
    selectedModel,
    availableModels,
    setSelectedModel,
    setAvailableModels
  } = useChatStore()

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Refresh models when opening settings.
  useEffect(() => {
    const refreshModels = async () => {
      try {
        const models = await window.api.ollama.listModels()
        const modelNames = filterOllamaModels(models.map((m) => m.name))
        setAvailableModels(modelNames)
        if (modelNames.length > 0 && (!selectedModel || !modelNames.includes(selectedModel))) {
          setSelectedModel(modelNames[0])
        }
      } catch (e) {
        console.error('Failed to refresh models in settings:', e)
      }
    }
    refreshModels()
  }, [selectedModel, setAvailableModels, setSelectedModel])

  const persistSetting = (key: string, value: unknown) => {
    void window.api.settings.set(key, value)
  }

  const handleTtsVoiceChange = (voice: TtsVoice) => {
    setTtsVoice(voice)
    persistSetting('ttsVoice', voice)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-alt rounded-xl shadow-2xl border border-border w-[520px] max-h-[80vh] overflow-y-auto ui-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-lg text-on-surface">Settings</h2>
          <button
            onClick={onClose}
            className="text-on-surface-muted hover:text-on-surface transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* ─── Appearance ─── */}
          <section>
            <h3 className="text-sm font-semibold text-on-surface mb-3">Appearance</h3>
            <div className="space-y-4">
              {/* Theme */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Theme</label>
                <div className="flex gap-1">
                  {(['light', 'sepia', 'dark'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`px-3 py-1 rounded-md text-xs capitalize transition-colors ${
                        theme === t
                          ? 'bg-accent text-white'
                          : 'bg-surface border border-border text-on-surface-muted hover:text-on-surface'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Font Size</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={14}
                    max={22}
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="text-xs text-on-surface-muted w-8 text-right">{fontSize}px</span>
                </div>
              </div>

              {/* Line height */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Line Height</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1.4}
                    max={2.2}
                    step={0.05}
                    value={lineHeight}
                    onChange={(e) => setLineHeight(Number(e.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="text-xs text-on-surface-muted w-8 text-right">{lineHeight.toFixed(2)}</span>
                </div>
              </div>

              {/* Content width */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Content Width</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={contentWidth}
                    onChange={(e) => setContentWidth(Number(e.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="text-xs text-on-surface-muted w-8 text-right">{contentWidth}ch</span>
                </div>
              </div>
            </div>
          </section>

          {/* ─── AI ─── */}
          <section>
            <h3 className="text-sm font-semibold text-on-surface mb-3">AI Settings</h3>
            <div className="space-y-4">
              {/* Model */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Ollama Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="text-sm bg-surface border border-border rounded-md px-3 py-1 text-on-surface outline-none focus:border-accent w-44"
                >
                  {availableModels.length === 0 && <option>No models found</option>}
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* System prompt */}
              <div>
                <label className="text-sm text-on-surface-muted block mb-1.5">System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-accent resize-none"
                />
              </div>
            </div>
          </section>

          {/* ─── TTS ─── */}
          <section>
            <h3 className="text-sm font-semibold text-on-surface mb-3">Text to Speech</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Voice</label>
                <div className="flex gap-1">
                  {([
                    { id: 'Christopher', label: 'Christopher', detail: 'Male' },
                    { id: 'Ava', label: 'Ava', detail: 'Female' }
                  ] as Array<{ id: TtsVoice; label: string; detail: string }>).map((voice) => (
                    <button
                      key={voice.id}
                      onClick={() => handleTtsVoiceChange(voice.id)}
                      className={`px-3 py-1 rounded-md text-xs transition-colors ${
                        ttsVoice === voice.id
                          ? 'bg-accent text-white'
                          : 'bg-surface border border-border text-on-surface-muted hover:text-on-surface'
                      }`}
                      title={`${voice.label} (${voice.detail})`}
                    >
                      {voice.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
