import { useState, useEffect } from 'react'
import { TtsVoice, useSettingsStore } from '../store/useSettingsStore'
import { useChatStore } from '../store/useChatStore'
import { filterOllamaModels } from '../utils/ollama-model-filter'
import type { AgentMemoryStatus, AiProviderStatus } from '../global'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [memoryStatus, setMemoryStatus] = useState<AgentMemoryStatus | null>(null)
  const [aiProviderStatus, setAiProviderStatus] = useState<AiProviderStatus | null>(null)
  const [aiProviderDraft, setAiProviderDraft] = useState({
    ollamaApiKey: '',
    webSearchEnabled: true
  })
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

  useEffect(() => {
    const loadAiProviderStatus = async () => {
      try {
        const status = await window.api.aiProvider.status()
        setAiProviderStatus(status)
        setAiProviderDraft((draft) => ({
          ...draft,
          webSearchEnabled: status.webSearchEnabled
        }))
      } catch (error) {
        console.error('Failed to load AI provider status:', error)
      }
    }
    loadAiProviderStatus()
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

  const saveAiProviderSettings = async () => {
    try {
      const status = await window.api.aiProvider.updateSettings({
        ollamaApiKey: aiProviderDraft.ollamaApiKey.trim() || undefined,
        webSearchEnabled: aiProviderDraft.webSearchEnabled
      })
      setAiProviderStatus(status)
      setAiProviderDraft((draft) => ({ ...draft, ollamaApiKey: '' }))
      const models = await window.api.ollama.listModels()
      const modelNames = filterOllamaModels(models.map((m) => m.name))
      setAvailableModels(modelNames)
      if (!selectedModel && modelNames.length > 0) {
        setSelectedModel(modelNames[0])
      }
    } catch (error) {
      console.error('Failed to save AI provider settings:', error)
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

              {/* Page width */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-on-surface-muted">Page Width</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={52}
                    max={82}
                    step={2}
                    value={contentWidth}
                    onChange={(e) => setContentWidth(Number(e.target.value))}
                    className="w-28 accent-accent"
                  />
                  <span className="text-xs text-on-surface-muted w-8 text-right">{contentWidth}</span>
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
                  {!selectedModel && <option value="">Select model</option>}
                  {availableModels.length === 0 && <option value="">No models found</option>}
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-md border border-[var(--hair-2)] bg-surface px-3.5 py-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-on-surface">Ollama Cloud</div>
                    <div className="mt-0.5 text-xs text-on-surface-muted">
                      {aiProviderStatus?.hasOllamaApiKey
                        ? `API key saved${aiProviderStatus.apiKeySource === 'env' ? ' from environment' : ''}`
                        : 'API key required for cloud chat and web search'}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-on-surface-muted">
                    <input
                      type="checkbox"
                      checked={aiProviderDraft.webSearchEnabled}
                      onChange={(e) => setAiProviderDraft((draft) => ({ ...draft, webSearchEnabled: e.target.checked }))}
                      className="accent-accent"
                    />
                    Web Search
                  </label>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-on-surface-muted">
                    Ollama API Key {aiProviderStatus?.hasOllamaApiKey ? '(saved)' : ''}
                  </label>
                  <input
                    type="password"
                    value={aiProviderDraft.ollamaApiKey}
                    onChange={(e) => setAiProviderDraft((draft) => ({ ...draft, ollamaApiKey: e.target.value }))}
                    placeholder={aiProviderStatus?.hasOllamaApiKey ? 'Leave blank to keep existing key' : 'ollama_...'}
                    className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-on-surface outline-none focus:border-accent"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="truncate text-xs text-on-surface-muted" title={aiProviderStatus?.ollamaBaseUrl}>
                    {aiProviderStatus?.ollamaBaseUrl || 'https://ollama.com/v1'}
                  </span>
                  <button
                    onClick={saveAiProviderSettings}
                    className="rounded-md bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
                  >
                    Save
                  </button>
                </div>
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
