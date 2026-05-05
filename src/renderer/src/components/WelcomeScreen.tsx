import { useDocumentStore } from '../store/useDocumentStore'

interface WelcomeScreenProps {
  onOpenFile: () => void
}

export function WelcomeScreen({ onOpenFile }: WelcomeScreenProps) {
  const { recentFiles, setDocument } = useDocumentStore()

  const handleRecentClick = async (filePath: string) => {
    try {
      const result = await window.api.file.read(filePath)
      setDocument(result)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  const visibleRecent = recentFiles.slice(0, 6)

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="welcome-watermark pointer-events-none absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2">
        md
      </div>
      <main className="relative mx-auto flex min-h-full max-w-[920px] flex-col px-8 py-20">
        <section className="mx-auto max-w-[720px] text-center">
          <div className="small-caps mb-8 flex items-center justify-center gap-4 text-on-surface-muted">
            <span className="h-px w-8 bg-[var(--hair-3)]" />
            <span>Markdown · EPUB · Reader</span>
            <span className="h-px w-8 bg-[var(--hair-3)]" />
          </div>
          <h1 className="font-serif text-[84px] font-light leading-none tracking-[-0.025em] text-on-surface">
            Read <em className="font-light italic">beautifully</em>,<br />
            ask <em className="font-light italic text-accent">intelligently</em>.
          </h1>
          <p className="mx-auto mt-9 max-w-[420px] text-[13px] font-medium leading-7 text-on-surface-muted">
            A quiet space for long-form documents — paired with a research assistant that knows what you're reading.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <button
              onClick={onOpenFile}
              className="inline-flex h-11 items-center gap-3 rounded px-6 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-surface transition-colors hover:bg-[var(--ink-2)]"
              style={{ background: 'var(--ink)' }}
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
                <path className="icon-stroke" d="M2.5 5.5h4.1l1.5 1.6h5.4v6.9h-11z" />
              </svg>
              Open Document
            </button>
            <span className="text-[13px] font-medium text-on-surface-muted">
              or drop .md / .epub <kbd className="ml-2 rounded border border-border bg-surface-alt px-1.5 py-1 font-mono text-[11px] text-on-surface">⌘</kbd>
              <kbd className="ml-1 rounded border border-border bg-surface-alt px-1.5 py-1 font-mono text-[11px] text-on-surface">O</kbd>
            </span>
          </div>
        </section>

        <section className="mt-24">
          <div className="mb-5 flex items-end justify-between border-b border-border pb-4">
            <h2 className="small-caps text-on-surface">Recent</h2>
            <div className="small-caps flex gap-6 text-on-surface-muted">
              <span className="border-b border-on-surface pb-1 text-on-surface">All</span>
              <span>Pinned</span>
              <span>This Week</span>
            </div>
          </div>
          <div>
            {visibleRecent.length > 0 ? visibleRecent.map((f, index) => (
              <button
                key={f}
                onClick={() => handleRecentClick(f)}
                className="group grid w-full grid-cols-[44px_1fr_auto_20px] items-center border-b border-border py-4 text-left transition-colors hover:bg-surface-alt/50"
              >
                <span className="mono-meta text-[11px] text-on-surface-muted">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block truncate font-serif text-[17px] leading-tight text-on-surface">{f.split('/').pop()}</span>
                  <span className="mono-meta mt-1 block truncate text-[11px] text-on-surface-muted">{f.replace(/\/[^/]+$/, '')}</span>
                </span>
                <span className="small-caps text-on-surface-muted">Recent</span>
                <span className="text-lg text-on-surface-muted transition-transform group-hover:translate-x-1">›</span>
              </button>
            )) : (
              <div className="border-b border-border py-8 text-center">
                <p className="font-serif text-[18px] text-on-surface">No recent files yet.</p>
                <p className="mt-1 text-[12px] text-on-surface-muted">Open a Markdown or EPUB file to start the list.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
