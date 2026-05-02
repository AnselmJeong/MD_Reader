import { useEffect, useCallback, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { DocumentReader } from './components/DocumentReader/DocumentReader'
import { ChatPanel } from './components/ChatPanel/ChatPanel'
import { StatusBar } from './components/StatusBar'
import { SettingsModal } from './components/SettingsModal'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useDocumentStore } from './store/useDocumentStore'
import { useChatStore } from './store/useChatStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useUIStore } from './store/useUIStore'
import { useTtsStore } from './store/useTtsStore'
import { filterOllamaModels } from './utils/ollama-model-filter'

export default function App() {
  const { filePath, content, isDirty, setDocument, setRecentFiles, markSaved } = useDocumentStore()
  
  // Use selectors to avoid re-rendering App on every token stream (streamingContent/messages updates)
  const setAvailableModels = useChatStore(s => s.setAvailableModels)
  const setSelectedModel = useChatStore(s => s.setSelectedModel)
  const availableModels = useChatStore(s => s.availableModels)
  const selectedModel = useChatStore(s => s.selectedModel)

  const { theme, fontSize, lineHeight, contentWidth, setTheme, setFontSize, cycleTheme } = useSettingsStore()
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

    const loadModels = async () => {
      const maxAttempts = 4
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const models = await window.api.ollama.listModels()
          const modelNames = filterOllamaModels(models.map((m) => m.name))
          if (modelNames.length > 0) {
            setAvailableModels(modelNames)
            if (!selectedModel || !modelNames.includes(selectedModel)) {
              setSelectedModel(modelNames[0])
            }
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
      } catch (e) {
        console.error('Settings init error:', e)
      }

      try {
        const recent = await window.api.file.getRecent()
        setRecentFiles(recent)
      } catch (e) {
        console.error('Recent files init error:', e)
      }

      await loadModels()
    }
    init()
    initializeTtsListeners()
  }, [initializeTtsListeners])

  // File open handler
  const handleOpenFile = useCallback(async () => {
    const result = await window.api.file.openDialog()
    if (result) {
      setDocument(result.filePath, result.content, result.bibContent || null)
    }
  }, [setDocument])

  const handleSaveFile = useCallback(async () => {
    if (!filePath || content == null) return
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
  }, [content, filePath, markSaved])

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
      
      const file = files[0]
      const name = file.name.toLowerCase()
      // Use the new API to get the path
      const filePath = window.api.utils.getPathForFile(file)
      
      if (filePath && (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt'))) {
        const result = await window.api.file.read(filePath)
        setDocument(result.filePath, result.content, result.bibContent || null)
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
    <div className="h-screen w-screen overflow-hidden bg-background relative selection:bg-accent/30 text-on-surface">
      {/* Toolbar (Fixed Top) */}
      <div className="absolute top-0 left-0 right-0 h-11 z-20">
        <Toolbar
          onOpenFile={handleOpenFile}
          onSaveFile={handleSaveFile}
          canSave={Boolean(filePath && content !== null)}
          isDirty={isDirty}
        />
      </div>

      {/* Main Content Area (Absolute Middle) */}
      <div className="absolute top-11 bottom-6 left-0 right-0 flex overflow-hidden">
        
        {/* Document Reader */}
        <div className="flex-1 h-full relative min-w-0">
          <div 
            className="absolute inset-0 overflow-y-auto"
            style={{
              '--font-size': `${fontSize}px`,
              '--line-height': `${lineHeight}`,
              '--content-width': `${contentWidth}`
            } as React.CSSProperties}
          >
            {content ? <DocumentReader /> : <WelcomeScreen onOpenFile={handleOpenFile} />}
          </div>
        </div>

        {/* Resizable Chat Panel */}
        {showChat && (
          <>
            {/* Resize Handle */}
            <div
              className="w-1 hover:w-1.5 transition-all bg-border hover:bg-accent cursor-col-resize z-30 relative -mr-0.5 h-full flex-shrink-0"
              onMouseDown={startResizing}
            />
            {/* Chat Panel Wrapper */}
            <div 
              className="h-full bg-surface border-l border-border relative flex-shrink-0" 
              style={{ width: `${chatWidth}px` }}
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
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-surface border-2 border-dashed border-accent rounded-3xl p-12 text-center animate-pulse">
            <div className="text-6xl mb-4">📂</div>
            <h2 className="text-2xl font-bold text-accent mb-2">Drop markdown file here</h2>
            <p className="text-on-surface-muted">to open directly</p>
          </div>
        </div>
      )}
    </div>
  )
}
