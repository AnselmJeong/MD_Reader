import { useDocumentStore } from '../store/useDocumentStore'

interface WelcomeScreenProps {
  onOpenFile: () => void
}

export function WelcomeScreen({ onOpenFile }: WelcomeScreenProps) {
  const { recentFiles, setDocument } = useDocumentStore()

  const handleRecentClick = async (filePath: string) => {
    try {
      const result = await window.api.file.read(filePath)
      setDocument(result.filePath, result.content, result.bibContent || null)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-8">
        {/* Logo area */}
        <div className="mb-8">
          <div className="text-6xl mb-4">📖</div>
          <h1 className="text-2xl font-bold text-on-surface font-sans mb-2">MD Reader</h1>
          <p className="text-on-surface-muted text-sm">
            Read beautifully, Ask intelligently.
          </p>
        </div>

        {/* Open button */}
        <button
          onClick={onOpenFile}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent-hover transition-colors shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
          </svg>
          Open Markdown File
        </button>

        <p className="mt-3 text-xs text-on-surface-muted/60">
          or drag & drop a .md file · ⌘O
        </p>

        {/* Recent files */}
        {recentFiles.length > 0 && (
          <div className="mt-10 text-left">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-muted mb-3 font-sans">
              Recent Files
            </h2>
            <div className="space-y-1">
              {recentFiles.slice(0, 8).map((f) => (
                <button
                  key={f}
                  onClick={() => handleRecentClick(f)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-on-surface-muted hover:text-on-surface hover:bg-surface-alt transition-colors truncate"
                >
                  <span className="text-on-surface font-medium">{f.split('/').pop()}</span>
                  <span className="ml-2 text-xs text-on-surface-muted/50">{f}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
