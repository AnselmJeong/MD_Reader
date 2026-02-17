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

export default function App() {
  const { content, setDocument, setRecentFiles } = useDocumentStore()
  
  // Use selectors to avoid re-rendering App on every token stream (streamingContent/messages updates)
  const setAvailableModels = useChatStore(s => s.setAvailableModels)
  const setSelectedModel = useChatStore(s => s.setSelectedModel)
  const availableModels = useChatStore(s => s.availableModels)
  const selectedModel = useChatStore(s => s.selectedModel)

  const { theme, fontSize, lineHeight, contentWidth, setTheme, setFontSize, cycleTheme } = useSettingsStore()
  const { showChat, showSettings, toggleChat, toggleSettings, toggleToC, toggleSearch, chatWidth, setChatWidth } = useUIStore()

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
    const init = async () => {
      try {
        const settings = (await window.api.settings.get()) as Record<string, unknown>
        if (settings?.theme) setTheme(settings.theme as 'light' | 'sepia' | 'dark')
        if (settings?.fontSize) setFontSize(settings.fontSize as number)

        const recent = await window.api.file.getRecent()
        setRecentFiles(recent)

        const models = await window.api.ollama.listModels()
        const modelNames = models.map((m) => m.name)
        setAvailableModels(modelNames)
        if (modelNames.length > 0 && !selectedModel) {
          setSelectedModel(modelNames[0])
        }
      } catch (e) {
        console.error('Init error:', e)
      }
    }
    init()
  }, [])

  // File open handler
  const handleOpenFile = useCallback(async () => {
    const result = await window.api.file.openDialog()
    if (result) {
      setDocument(result.filePath, result.content, result.bibContent || null)
    }
  }, [setDocument])

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
      if (file.path && (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt'))) {
        const result = await window.api.file.read(file.path)
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
      if (mod && e.key === '/') { e.preventDefault(); toggleChat() }
      if (mod && e.shiftKey && e.key === 'T') { e.preventDefault(); toggleToC() }
      if (mod && e.key === 'f') { e.preventDefault(); toggleSearch() }
      if (mod && e.shiftKey && e.key === 'D') { e.preventDefault(); cycleTheme() }
      if (mod && e.key === '=') { e.preventDefault(); setFontSize(fontSize + 1) }
      if (mod && e.key === '-') { e.preventDefault(); setFontSize(fontSize - 1) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFile, toggleChat, toggleToC, toggleSearch, cycleTheme, fontSize, setFontSize])

  return (
    <div className="h-screen w-screen overflow-hidden bg-background relative selection:bg-accent/30 text-on-surface">
      {/* Toolbar (Fixed Top) */}
      <div className="absolute top-0 left-0 right-0 h-11 z-20">
        <Toolbar onOpenFile={handleOpenFile} />
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
