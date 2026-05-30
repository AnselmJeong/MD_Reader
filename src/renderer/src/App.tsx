import { useEffect, useCallback, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { DocumentReader } from './components/DocumentReader/DocumentReader'
import { ChatPanel } from './components/ChatPanel/ChatPanel'
import { StatusBar } from './components/StatusBar'
import { SettingsModal } from './components/SettingsModal'
import { WelcomeScreen } from './components/WelcomeScreen'
import { DocumentTabs } from './components/DocumentTabs'
import { useDocumentStore } from './store/useDocumentStore'
import { useChatStore } from './store/useChatStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useUIStore } from './store/useUIStore'
import { useTtsStore } from './store/useTtsStore'
import { filterOllamaModels } from './utils/ollama-model-filter'

export default function App() {
  const { activeTab, filePath, content, kind, isDirty, setDocument, setRecentFiles, markSaved } = useDocumentStore()
  
  // Use selectors to avoid re-rendering App on every token stream (streamingContent/messages updates)
  const setAvailableModels = useChatStore(s => s.setAvailableModels)
  const setSelectedModel = useChatStore(s => s.setSelectedModel)

  const { fontSize, aiSidebarFontSize, lineHeight, contentWidth, setTheme, setFontSize, setAiSidebarFontSize, setLineHeight, setContentWidth, setTtsVoice, cycleTheme } = useSettingsStore()
  const { showChat, showSettings, toggleChat, toggleSettings, toggleToC, setShowSearch, chatWidth, setChatWidth } = useUIStore()
  const initializeTtsListeners = useTtsStore(s => s.initializeListeners)

  // Resize logic
  const isResizing = useRef(false)
  const sidebarWidthRef = useRef(chatWidth)

  const startResizing = useCallback(() => {
    isResizing.current = true
    document.addEventListener('mousemove', resize)
    document.addEventListener('mouseup', stopResizing)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const stopResizing = useCallback(() => {
    isResizing.current = false
    document.removeEventListener('mousemove', resize)
    document.removeEventListener('mouseup', stopResizing)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing.current) {
      const newWidth = window.innerWidth - e.clientX
      // Min 300px, Max 800px (or 60% of screen)
      const clampedWidth = Math.max(300, Math.min(newWidth, window.innerWidth * 0.6))
      sidebarWidthRef.current = clampedWidth
      setChatWidth(clampedWidth)
    }
  }, [setChatWidth])

  // Load initial settings & models
  useEffect(() => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const loadModels = async (preferredModel?: string) => {
      const maxAttempts = 4
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const models = await window.api.ollama.listModels()
          const modelNames = filterOllamaModels(models.map((m) => m.name))
          if (modelNames.length > 0) {
            setAvailableModels(modelNames)
            setSelectedModel(preferredModel && modelNames.includes(preferredModel) ? preferredModel : modelNames[0])
            return
          }
        } catch (e) {
          console.error(`Model load attempt ${attempt} failed:`, e)
        }
        if (attempt < maxAttempts) await sleep(800)
      }
      setAvailableModels([])
    }

    const init = async () => {
      try {
        const settings = (await window.api.settings.get()) as Record<string, unknown>
        if (settings?.theme) setTheme(settings.theme as 'light' | 'sepia' | 'dark')
        if (settings?.fontSize) setFontSize(settings.fontSize as number)
        if (settings?.aiSidebarFontSize) setAiSidebarFontSize(settings.aiSidebarFontSize as number)
        if (settings?.lineHeight) setLineHeight(settings.lineHeight as number)
        if (settings?.contentWidth) setContentWidth(settings.contentWidth as number)
        if (settings?.ttsVoice === 'Ava' || settings?.ttsVoice === 'Christopher') {
          setTtsVoice(settings.ttsVoice)
        }
        await loadModels(typeof settings?.ollamaModel === 'string' ? settings.ollamaModel : undefined)
      } catch (e) {
        console.error('Settings init error:', e)
        await loadModels()
      }

      try {
        const recent = await window.api.file.getRecent()
        setRecentFiles(recent)
      } catch (e) {
        console.error('Recent files init error:', e)
      }

    }
    init()
    initializeTtsListeners()
  }, [initializeTtsListeners, setAiSidebarFontSize, setAvailableModels, setContentWidth, setFontSize, setLineHeight, setRecentFiles, setSelectedModel, setTheme, setTtsVoice])

  // File open handler
  const handleOpenFile = useCallback(async () => {
    const result = await window.api.file.openDialog()
    if (result) {
      setDocument(result)
    }
  }, [setDocument])

  const handleSaveFile = useCallback(async () => {
    if (!filePath || content == null || kind !== 'markdown') return
    try {
      const result = await window.api.file.save(filePath, content)
      if (!result.success) {
        console.error('Save failed:', result.error || 'Unknown error')
        return
      }
      markSaved()
    } catch (error) {
      console.error('Save failed:', error)
    }
  }, [content, filePath, kind, markSaved])

  // Drag & drop
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true)
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      dragCounter.current = 0
      
      const files = e.dataTransfer?.files
      if (!files?.length) return

      for (const file of Array.from(files)) {
        const name = file.name.toLowerCase()
        const filePath = window.api.utils.getPathForFile(file)

        if (filePath && (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.epub'))) {
          const result = await window.api.file.read(filePath)
          setDocument(result)
        }
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [setDocument])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'o') { e.preventDefault(); handleOpenFile() }
      if (mod && e.key === 's') { e.preventDefault(); handleSaveFile() }
      if (mod && e.key === '/') { e.preventDefault(); toggleChat() }
      if (mod && e.shiftKey && e.key === 'T') { e.preventDefault(); toggleToC() }
      if (mod && e.key === 'f') { e.preventDefault(); setShowSearch(true) }
      if (mod && e.shiftKey && e.key === 'D') { e.preventDefault(); cycleTheme() }
      if (mod && e.key === '=') { e.preventDefault(); setFontSize(fontSize + 1) }
      if (mod && e.key === '-') { e.preventDefault(); setFontSize(fontSize - 1) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFile, handleSaveFile, toggleChat, toggleToC, setShowSearch, cycleTheme, fontSize, setFontSize])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-surface text-on-surface selection:bg-accent/20">
      {/* Toolbar (Fixed Top) */}
      <div className="absolute left-0 right-0 top-0 z-20 h-[38px]">
        <Toolbar
          onOpenFile={handleOpenFile}
          onSaveFile={handleSaveFile}
          canSave={Boolean(filePath && content !== null && kind === 'markdown')}
          isDirty={isDirty}
        />
      </div>

      {/* Main Content Area (Absolute Middle) */}
      <div className="absolute bottom-6 left-0 right-0 top-[38px] flex overflow-hidden">
        
        {/* Document Reader */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {activeTab && <DocumentTabs />}
          <div className="relative min-h-0 flex-1">
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                '--font-size': `${fontSize}px`,
                '--line-height': `${lineHeight}`,
                '--content-width': `${contentWidth}`
              } as React.CSSProperties}
            >
              {activeTab ? <DocumentReader /> : <WelcomeScreen onOpenFile={handleOpenFile} />}
            </div>
          </div>
        </div>

        {/* Resizable Chat Panel */}
        {showChat && (
          <>
            {/* Resize Handle */}
            <div
              className="relative z-30 h-full w-px flex-shrink-0 cursor-col-resize bg-border transition-all hover:bg-[var(--hair-3)]"
              onMouseDown={startResizing}
            />
            {/* Chat Panel Wrapper */}
            <div 
              className="relative h-full flex-shrink-0 border-l border-border bg-surface" 
              style={{
                width: `${chatWidth}px`,
                '--ai-sidebar-font-size': `${aiSidebarFontSize}px`
              } as React.CSSProperties}
            >
              <div className="absolute inset-0 overflow-hidden">
                <ChatPanel />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Status Bar (Fixed Bottom) */}
      <div className="absolute bottom-0 left-0 right-0 h-6 z-20">
        <StatusBar />
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && <SettingsModal onClose={toggleSettings} />}

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-surface/85 backdrop-blur-sm">
          <div className="rounded-lg border border-dashed border-accent px-12 py-10 text-center">
            <div className="small-caps mb-4 text-accent">Drop Document</div>
            <h2 className="font-serif text-3xl text-on-surface">Open this document</h2>
            <p className="mt-2 text-sm text-on-surface-muted">Release to begin reading.</p>
          </div>
        </div>
      )}
    </div>
  )
}
