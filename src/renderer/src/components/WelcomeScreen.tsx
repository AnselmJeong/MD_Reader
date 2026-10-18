import { useState } from 'react'
import { ArrowUpRight, BookOpen, FileText, FolderOpen, Search, Upload, Clock3 } from 'lucide-react'
import { useDocumentStore } from '../store/useDocumentStore'
import { Button } from './ui/button'
import { Badge } from './reui/badge'
import { Frame, FrameHeader, FramePanel, FrameTitle } from './reui/frame'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from './ui/empty'
import { Alert, AlertDescription } from './ui/alert'

interface WelcomeScreenProps { onOpenFile: () => void; onDocumentOpened: () => void }
const filename = (path: string) => path.split('/').pop() || path
const folder = (path: string) => path.split('/').slice(-2, -1)[0] || 'Local documents'
const format = (path: string) => path.split('.').pop()?.toUpperCase() || 'DOC'

export function WelcomeScreen({ onOpenFile, onDocumentOpened }: WelcomeScreenProps) {
  const { recentFiles, setDocument } = useDocumentStore()
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')
  const recent = recentFiles.filter(path => filename(path).toLowerCase().includes(query.toLowerCase()))
  const featured = !query && recentFiles[0]
  const openRecent = async (path: string) => {
    if (opening) return
    setOpening(path); setError('')
    try {
      const existing = useDocumentStore.getState().tabs.find(tab => tab.filePath === path)
      if (existing) useDocumentStore.getState().selectTab(existing.id)
      else setDocument(await window.api.file.read(path))
      onDocumentOpened()
    }
    catch (e) { setError(e instanceof Error ? e.message : '문서를 열 수 없습니다. 파일 위치를 확인해 주세요.') }
    finally { setOpening(null) }
  }

  return <main className="home-workspace">
    <header className="home-heading">
      <div><p className="workspace-eyebrow">YOUR READING SPACE</p><h1>다시, 읽던 곳으로.</h1><p>최근 문서를 열거나 새 문서를 가져오세요.</p></div>
      <Button onClick={onOpenFile}><FolderOpen data-icon="inline-start" />문서 열기<kbd>⌘O</kbd></Button>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {featured && <section className="home-featured" aria-label="마지막으로 열었던 문서">
      <div className="document-cover" aria-hidden="true"><BookOpen /><span>MD READER</span><strong>{format(featured)}</strong><i /></div>
      <div className="featured-details"><Badge variant="primary-light" radius="full">마지막으로 열었던 문서</Badge><h2 title={filename(featured)}>{filename(featured).replace(/\.(epub|md|qmd|markdown|txt)$/i, '').replace(/[-_]/g, ' ')}</h2><p><FolderOpen />{folder(featured)}</p><Button variant="outline" disabled={Boolean(opening)} onClick={() => void openRecent(featured)}>{opening === featured ? '여는 중…' : '다시 열기'}<ArrowUpRight data-icon="inline-end" /></Button></div>
    </section>}
    <Frame variant="ghost" className="recent-frame">
      <FrameHeader className="recent-heading"><FrameTitle><Clock3 />최근 문서 <Badge variant="secondary" radius="full">{recentFiles.length}</Badge></FrameTitle><label className="recent-search"><Search /><input aria-label="최근 문서 검색" placeholder="문서 찾기" value={query} onChange={e => setQuery(e.target.value)} /></label></FrameHeader>
      <FramePanel className="recent-panel">
        {recent.length ? <div className="recent-list">{recent.map(path => <button key={path} className="recent-document" onClick={() => void openRecent(path)} disabled={Boolean(opening)} title={path}>
          <span className="file-symbol" data-format={format(path)}>{format(path) === 'EPUB' ? <BookOpen /> : <FileText />}</span>
          <span className="recent-document-info"><strong>{filename(path)}</strong><small>{folder(path)}</small></span>
          <Badge variant="outline">{format(path)}</Badge><ArrowUpRight className="recent-arrow" />
        </button>)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>{query ? '검색 결과가 없습니다' : '첫 문서를 열어보세요'}</EmptyTitle><EmptyDescription>{query ? '다른 문서 이름으로 검색해 주세요.' : 'Markdown, Quarto, EPUB을 한곳에서 읽고 질문하세요.'}</EmptyDescription></EmptyHeader>{!query && <Button variant="outline" onClick={onOpenFile}>문서 선택</Button>}</Empty>}
      </FramePanel>
    </Frame>
    <button className="home-dropzone" onClick={onOpenFile}><span><Upload /></span><div><strong>문서를 이곳에 놓으세요</strong><small>.md · .qmd · .epub · .txt</small></div><kbd>⌘O</kbd></button>
  </main>
}
