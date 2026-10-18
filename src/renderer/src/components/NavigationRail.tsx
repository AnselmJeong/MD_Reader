import { BookOpen, FolderOpen, Home, Settings2 } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
export function NavigationRail({ home, hasDocument, onHome, onReader, onOpen }: { home: boolean; hasDocument: boolean; onHome: () => void; onReader: () => void; onOpen: () => void }) {
  return <nav className="navigation-rail" aria-label="주 탐색">
    <span className="rail-monogram" aria-hidden="true">md</span>
    <button aria-label="홈" title="홈 · 최근 문서" aria-current={home ? 'page' : undefined} onClick={onHome}><Home /></button>
    <button aria-label="읽기 화면" title="열려 있는 문서" aria-current={!home ? 'page' : undefined} disabled={!hasDocument} onClick={onReader}><BookOpen /></button>
    <button aria-label="문서 열기" title="문서 열기 (⌘O)" onClick={onOpen}><FolderOpen /></button>
    <button className="rail-settings" aria-label="설정 열기" title="설정" onClick={() => useUIStore.getState().toggleSettings()}><Settings2 /></button>
  </nav>
}
