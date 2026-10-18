import { FolderOpen, Save, Search, Sparkles, Settings2 } from 'lucide-react'
import { BibliographyControl } from './BibliographyControl'
import { useUIStore } from '../store/useUIStore'
import { useDocumentStore } from '../store/useDocumentStore'
import { Button } from './ui/button'

interface ToolbarProps { onOpenFile: () => void; onSaveFile: () => void; canSave: boolean; isDirty: boolean }
export function Toolbar({ onOpenFile, onSaveFile, canSave, isDirty }: ToolbarProps) {
  const { toggleSearch, toggleChat, showChat, toggleSettings } = useUIStore()
  const { activeTab, fileName, isDirty: documentIsDirty } = useDocumentStore()
  return <header className="app-toolbar titlebar-drag">
    <span className="app-wordmark">MD Reader</span>
    <span className="toolbar-document" title={fileName || ''}>{fileName}{documentIsDirty ? ' · edited' : ''}</span>
    <div className="toolbar-actions titlebar-no-drag">
      <Button variant="ghost" size="sm" onClick={onOpenFile} title="Open File (⌘O)"><FolderOpen data-icon="inline-start" /><span>열기</span></Button>
      <Button variant="ghost" size="sm" onClick={onSaveFile} disabled={!canSave} title="Save File (⌘S)"><Save data-icon="inline-start" /><span>저장{isDirty ? ' *' : ''}</span></Button>
      {activeTab?.kind === 'markdown' && <BibliographyControl key={activeTab.id} tab={activeTab} />}
      <Button variant="ghost" size="icon-sm" onClick={toggleSearch} title="Search (⌘F)" aria-label="문서 검색"><Search /></Button>
      <span className="toolbar-divider" />
      <Button variant={showChat ? 'default' : 'outline'} size="sm" onClick={toggleChat} title="Toggle Chat (⌘/)" aria-pressed={showChat}><Sparkles data-icon="inline-start" /><span>Ask AI</span></Button>
      <Button variant="ghost" size="icon-sm" onClick={toggleSettings} title="Settings" aria-label="설정"><Settings2 /></Button>
    </div>
  </header>
}
