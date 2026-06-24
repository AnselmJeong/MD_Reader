import { useState, useEffect } from 'react'
import { TtsVoice, useSettingsStore } from '../store/useSettingsStore'
import { useChatStore } from '../store/useChatStore'
import { filterOllamaModels } from '../utils/ollama-model-filter'
import type { AgentMemoryStatus } from '../global'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [memoryStatus, setMemoryStatus] = useState<AgentMemoryStatus | null>(null)
  const [memoryDraft, setMemoryDraft] = useState({
    enabled: true,
    extractionEnabled: true,
    runtimeInjectionEnabled: true,
    mem0BaseUrl: 'http://127.0.0.1:8888',
    mem0ApiKey: '',
    userId: 'md-reader-user',
    extractorModel: ''
  })
  const {
    theme,
    fontSize,
    aiSidebarFontSize,
    lineHeight,
    contentWidth,
    ttsVoice,
    setTheme,
    setFontSize,
    setAiSidebarFontSize,
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

  useEffect(() => {
    const loadMemoryStatus = async () => {
      try {
        const status = await window.api.agentMemory.status()
        setMemoryStatus(status)
        setMemoryDraft((draft) => ({
          ...draft,
          enabled: status.settings.enabled ?? draft.enabled,
          extractionEnabled: status.settings.extractionEnabled ?? draft.extractionEnabled,
          runtimeInjectionEnabled: status.settings.runtimeInjectionEnabled ?? draft.runtimeInjectionEnabled,
          mem0BaseUrl: status.settings.mem0BaseUrl ?? draft.mem0BaseUrl,
          userId: status.settings.userId ?? draft.userId,
          extractorModel: status.settings.extractorModel ?? draft.extractorModel
        }))
      } catch (error) {
        console.error('Failed to load agent memory status:', error)
      }
    }
    loadMemoryStatus()
  }, [])

  const saveMemorySettings = async () => {
    try {
      const status = await window.api.agentMemory.updateSettings({
        enabled: memoryDraft.enabled,
        extractionEnabled: memoryDraft.extractionEnabled,
        runtimeInjectionEnabled: memoryDraft.runtimeInjectionEnabled,
        mem0BaseUrl: memoryDraft.mem0BaseUrl.trim(),
        mem0ApiKey: memoryDraft.mem0ApiKey.trim() || undefined,
        mem0AuthMode: 'x-api-key',
        userId: memoryDraft.userId.trim(),
        extractorModel: memoryDraft.extractorModel.trim()
      })
      setMemoryStatus(status)
      setMemoryDraft((draft) => ({ ...draft, mem0ApiKey: '' }))
    } catch (error) {
      console.error('Failed to save agent memory settings:', error)
    }
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
              {/* Sidebar font size */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Sidebar Font Size</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={12}
                    max={20}
                    value={aiSidebarFontSize}
                    onChange={(e) => setAiSidebarFontSize(Number(e.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="text-xs text-on-surface-muted w-8 text-right">{aiSidebarFontSize}px</span>
                </div>
              </div>

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
                      onClick={() => setTtsVoice(voice.id)}
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

          {/* ─── Agent Memory ─── */}
          <section>
            <h3 className="text-sm font-semibold text-on-surface mb-3">Agent Memory</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-on-surface-muted">Enable Memory</label>
                <input
                  type="checkbox"
                  checked={memoryDraft.enabled}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, enabled: e.target.checked }))}
                  className="accent-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-on-surface-muted">Extract on Session End</label>
                <input
                  type="checkbox"
                  checked={memoryDraft.extractionEnabled}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, extractionEnabled: e.target.checked }))}
                  className="accent-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-on-surface-muted">Use in Chat</label>
                <input
                  type="checkbox"
                  checked={memoryDraft.runtimeInjectionEnabled}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, runtimeInjectionEnabled: e.target.checked }))}
                  className="accent-accent"
                />
              </div>
              <div>
                <label className="text-sm text-on-surface-muted block mb-1.5">mem0 Base URL</label>
                <input
                  value={memoryDraft.mem0BaseUrl}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, mem0BaseUrl: e.target.value }))}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-sm text-on-surface-muted block mb-1.5">
                  mem0 API Key {memoryStatus?.settings.hasMem0ApiKey ? '(saved)' : ''}
                </label>
                <input
                  type="password"
                  value={memoryDraft.mem0ApiKey}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, mem0ApiKey: e.target.value }))}
                  placeholder={memoryStatus?.settings.hasMem0ApiKey ? 'Leave blank to keep existing key' : 'm0sk_...'}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-sm text-on-surface-muted block mb-1.5">Memory User ID</label>
                <input
                  value={memoryDraft.userId}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, userId: e.target.value }))}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-sm text-on-surface-muted block mb-1.5">Extractor Model</label>
                <input
                  value={memoryDraft.extractorModel}
                  onChange={(e) => setMemoryDraft((draft) => ({ ...draft, extractorModel: e.target.value }))}
                  placeholder={selectedModel || 'Uses saved chat model if blank'}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-xs ${memoryStatus?.mem0.ok ? 'text-green-600' : 'text-on-surface-muted'}`}>
                  {memoryStatus?.mem0.ok ? 'mem0 reachable' : memoryStatus?.mem0.error || 'mem0 not checked'}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => void window.api.agentMemory.openFolder()}
                    className="px-3 py-1 rounded-md text-xs bg-surface border border-border text-on-surface-muted hover:text-on-surface"
                  >
                    Folder
                  </button>
                  <button
                    onClick={saveMemorySettings}
                    className="px-3 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent-hover"
                  >
                    Save
                  </button>
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
