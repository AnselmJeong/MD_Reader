import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BookOpen, FolderOpen, Search, Upload, Clock3, X, Trash2, CloudOff, FileQuestion } from 'lucide-react'
import { useDocumentStore } from '../store/useDocumentStore'
import { Button } from './ui/button'
import { Badge } from './reui/badge'
import { Frame, FrameHeader, FramePanel, FrameTitle } from './reui/frame'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from './ui/empty'
import { Alert, AlertDescription } from './ui/alert'

interface WelcomeScreenProps { onOpenFile: () => void; onDocumentOpened: () => void }
type FileStatus = 'ok' | 'missing' | 'offline'
interface CoverInfo { title: string | null; author: string | null; cover: string | null }

const filename = (path: string) => path.split('/').pop() || path
const folder = (path: string) => path.split('/').slice(-2, -1)[0] || 'Local documents'
const format = (path: string) => path.split('.').pop()?.toUpperCase() || 'DOC'
const prettyName = (path: string) => filename(path).replace(/\.(epub|md|qmd|markdown|txt)$/i, '').replace(/[-_]/g, ' ')
const hue = (path: string) => [...path].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7)

// Kept across visits to the home screen so covers do not flash or reload.
const coverCache = new Map<string, CoverInfo>()
const statusCache = new Map<string, FileStatus>()

function BookCover({ path, info, status }: { path: string; info?: CoverInfo; status?: FileStatus }) {
  const title = info?.title || prettyName(path)
  if (info?.cover && status !== 'missing') return <img className="book-cover-image" src={info.cover} alt="" draggable={false} />
  return <div className="book-cover-placeholder" style={{ '--cover-hue': hue(path) } as React.CSSProperties} aria-hidden="true">
    <span>{format(path)}</span>
    <strong>{title}</strong>
    {info?.author && <small>{info.author}</small>}
    <i />
  </div>
}

export function WelcomeScreen({ onOpenFile, onDocumentOpened }: WelcomeScreenProps) {
  const { recentFiles, setDocument, setRecentFiles } = useDocumentStore()
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; path?: string } | null>(null)
  const [covers, setCovers] = useState<Map<string, CoverInfo>>(() => new Map(coverCache))
  const [statuses, setStatuses] = useState<Map<string, FileStatus>>(() => new Map(statusCache))

  useEffect(() => {
    let active = true
    void window.api.file.getRecentInfo(recentFiles).then(infos => {
      infos.forEach(info => statusCache.set(info.filePath, info.status))
      if (!active) return
      setStatuses(new Map(statusCache))
      // Load covers one at a time: large EPUBs on a NAS should not all be read at once.
      void (async () => {
        for (const { filePath, status } of infos) {
          if (!active) return
          if (status !== 'ok' || coverCache.has(filePath)) continue
          const cover = await window.api.file.getRecentCover(filePath)
          coverCache.set(filePath, cover)
          if (active) setCovers(new Map(coverCache))
        }
      })()
    }).catch(console.error)
    return () => { active = false }
  }, [recentFiles])

  const titleOf = (path: string) => covers.get(path)?.title || prettyName(path)
  const recent = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return recentFiles
    return recentFiles.filter(path => `${filename(path)} ${covers.get(path)?.title ?? ''} ${covers.get(path)?.author ?? ''}`.toLowerCase().includes(needle))
  }, [covers, query, recentFiles])
  const missing = recentFiles.filter(path => statuses.get(path) === 'missing')
  const featured = !query ? recentFiles.find(path => statuses.get(path) !== 'missing') : undefined

  const removeRecent = async (paths: string[]) => {
    const next = await window.api.file.removeRecent(paths)
    paths.forEach(path => { coverCache.delete(path); statusCache.delete(path) })
    setRecentFiles(next)
    setError(current => current?.path && paths.includes(current.path) ? null : current)
  }

  const openRecent = async (path: string) => {
    if (opening) return
    setError(null)
    const status = statuses.get(path)
    if (status === 'missing') { setError({ message: `파일을 찾을 수 없습니다: ${path}`, path }); return }
    setOpening(path)
    try {
      const existing = useDocumentStore.getState().tabs.find(tab => tab.filePath === path)
      if (existing) useDocumentStore.getState().selectTab(existing.id)
      else setDocument(await window.api.file.read(path))
      onDocumentOpened()
    } catch (e) {
      const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      if (/ENOENT/.test(message)) {
        statusCache.set(path, 'missing'); setStatuses(new Map(statusCache))
        setError({ message: `파일을 찾을 수 없습니다: ${path}`, path })
      } else setError({ message: message || '문서를 열 수 없습니다. 파일 위치를 확인해 주세요.' })
    } finally { setOpening(null) }
  }

  return <main className="home-workspace">
    <header className="home-heading">
      <div><p className="workspace-eyebrow">YOUR READING SPACE</p><h1>다시, 읽던 곳으로.</h1><p>최근 문서를 열거나 새 문서를 가져오세요.</p></div>
      <Button onClick={onOpenFile}><FolderOpen data-icon="inline-start" />문서 열기<kbd>⌘O</kbd></Button>
    </header>
    {error && <Alert variant="destructive" className="home-alert"><AlertDescription>
      <span>{error.message}</span>
      {error.path && <Button size="sm" variant="outline" onClick={() => void removeRecent([error.path!])}><Trash2 data-icon="inline-start" />목록에서 제거</Button>}
    </AlertDescription></Alert>}
    {featured && <section className="home-featured" aria-label="마지막으로 열었던 문서">
      <div className="featured-cover"><BookCover path={featured} info={covers.get(featured)} status={statuses.get(featured)} /></div>
      <div className="featured-details"><Badge variant="primary-light" radius="full">마지막으로 열었던 문서</Badge><h2 title={filename(featured)}>{titleOf(featured)}</h2><p><FolderOpen />{covers.get(featured)?.author ? `${covers.get(featured)!.author} · ${folder(featured)}` : folder(featured)}</p><Button variant="outline" disabled={Boolean(opening)} onClick={() => void openRecent(featured)}>{opening === featured ? '여는 중…' : '다시 열기'}<ArrowUpRight data-icon="inline-end" /></Button></div>
    </section>}
    <Frame variant="ghost" className="recent-frame">
      <FrameHeader className="recent-heading">
        <FrameTitle><Clock3 />최근 문서 <Badge variant="secondary" radius="full">{recentFiles.length}</Badge></FrameTitle>
        <div className="recent-tools">
          {missing.length > 0 && <Button size="sm" variant="ghost" className="recent-cleanup" onClick={() => void removeRecent(missing)} title="디스크에서 찾을 수 없는 문서를 목록에서 뺍니다. 파일은 지우지 않습니다.">
            <Trash2 data-icon="inline-start" />없는 파일 정리 ({missing.length})
          </Button>}
          <label className="recent-search"><Search /><input aria-label="최근 문서 검색" placeholder="문서 찾기" value={query} onChange={e => setQuery(e.target.value)} /></label>
        </div>
      </FrameHeader>
      <FramePanel className="recent-panel">
        {recent.length ? <div className="bookshelf">{recent.map(path => {
          const status = statuses.get(path)
          const info = covers.get(path)
          return <div key={path} className="book-card" data-status={status ?? 'ok'}>
            <button className="book-open" onClick={() => void openRecent(path)} disabled={Boolean(opening)} title={path}>
              <span className="book-cover">
                <BookCover path={path} info={info} status={status} />
                {status === 'missing' && <span className="book-flag"><FileQuestion />파일 없음</span>}
                {status === 'offline' && <span className="book-flag"><CloudOff />연결 안 됨</span>}
                {opening === path && <span className="book-flag">여는 중…</span>}
                {!status || status === 'ok' ? opening !== path && <span className="book-format">{format(path)}</span> : null}
              </span>
              <strong>{titleOf(path)}</strong>
              <small>{info?.author || folder(path)}</small>
            </button>
            <button className="book-remove" onClick={() => void removeRecent([path])} aria-label={`${titleOf(path)} 최근 목록에서 제거`} title="최근 목록에서 제거 (파일은 지우지 않음)"><X /></button>
          </div>
        })}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>{query ? '검색 결과가 없습니다' : '첫 문서를 열어보세요'}</EmptyTitle><EmptyDescription>{query ? '다른 문서 이름으로 검색해 주세요.' : 'Markdown, Quarto, EPUB을 한곳에서 읽고 질문하세요.'}</EmptyDescription></EmptyHeader>{!query && <Button variant="outline" onClick={onOpenFile}>문서 선택</Button>}</Empty>}
      </FramePanel>
    </Frame>
    <button className="home-dropzone" onClick={onOpenFile}><span><Upload /></span><div><strong>문서를 이곳에 놓으세요</strong><small>.md · .qmd · .epub · .txt</small></div><kbd>⌘O</kbd></button>
  </main>
}
