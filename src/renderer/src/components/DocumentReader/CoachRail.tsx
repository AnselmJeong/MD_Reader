import { useMemo, useState, type ReactElement } from 'react'
import { normalizeCoachText, profileMismatch, showsBriefing } from '../../../../shared/coach'
import { currentChapterDecks, currentChapterStatus, useCoachStore } from '../../store/useCoachStore'

/** Briefing before a chapter, the summary of the section on screen, and the recap at the chapter's end. */
export function CoachRail({ visibleText, atChapterEnd }: { visibleText: string; atChapterEnd: boolean }) {
  const preferences = useCoachStore(state => state.preferences)
  const profile = useCoachStore(state => state.profile)
  const mismatchAsked = useCoachStore(state => state.mismatchAsked)
  const documentId = useCoachStore(state => state.documentId)
  const chapterHref = useCoachStore(state => state.chapterHref)
  const deckMap = useCoachStore(state => state.decks)
  const decks = useMemo(() => currentChapterDecks({ documentId, chapterHref, decks: deckMap }), [documentId, chapterHref, deckMap])
  const status = useMemo(() => currentChapterStatus({ documentId, chapterHref, decks: deckMap }), [documentId, chapterHref, deckMap])
  const chapterKey = `${documentId}|${chapterHref}`
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  const visible = useMemo(() => normalizeCoachText(visibleText), [visibleText])
  const sections = useMemo(() => decks.flatMap(deck => deck.sections).filter(section => visible.includes(normalizeCoachText(section.quote))), [decks, visible])
  const brief = decks.map(deck => deck.brief).filter(Boolean)[0] ?? ''
  const recap = decks.flatMap(deck => deck.recap)
  const questions = decks.flatMap(deck => deck.questions)
  const mismatch = !mismatchAsked && decks[0] ? profileMismatch(preferences, profile, decks[0].domain) : null

  if (!preferences?.enabled || hidden[chapterKey]) return null
  const briefing = showsBriefing(preferences)
  const open = !collapsed[chapterKey]
  const items: ReactElement[] = []
  if (mismatch) items.push(<div key="mismatch" className="flex flex-col gap-1">
    <p>{mismatch}</p>
    <div className="flex gap-2"><button className="font-semibold text-accent" onClick={() => {
      const { preferences: current, savePreferences, setMismatchAsked } = useCoachStore.getState()
      setMismatchAsked()
      if (current) void savePreferences({ ...current, familiarity: 'some' })
    }}>바꾸기</button><button className="text-on-surface-muted" onClick={() => useCoachStore.getState().setMismatchAsked()}>그대로 두기</button></div>
  </div>)
  if (briefing && brief) items.push(<div key="brief"><p className="small-caps mb-1 text-on-surface-muted">이 장을 읽기 전에</p><p className="whitespace-pre-wrap">{brief}</p></div>)
  if (briefing) for (const section of sections.slice(0, 2)) items.push(<div key={`s:${section.quote}`}><p className="small-caps mb-1 text-on-surface-muted">이 절의 요지</p><p>{section.summary}</p></div>)
  if (atChapterEnd && (briefing || preferences.proactivity === 'active') && (recap.length || questions.length)) items.push(<div key="recap">
    <p className="small-caps mb-1 text-on-surface-muted">이 장 정리</p>
    <ul className="list-disc pl-4">{recap.map(item => <li key={item}>{item}</li>)}</ul>
    {questions.length > 0 && <><p className="small-caps mb-1 mt-2 text-on-surface-muted">스스로 확인해 볼 질문</p><ol className="list-decimal pl-4">{questions.map(item => <li key={item}>{item}</li>)}</ol></>}
  </div>)
  const working = status?.status === 'generating' || status?.status === 'queued'
  if (!items.length && !working) return null

  return <aside className="coach-rail ui-text" data-commentary-ui aria-label="독서 코치"
    style={{ position: 'absolute', top: 64, right: 16, zIndex: 25, width: 300, maxHeight: 'calc(100% - 140px)', overflowY: 'auto', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-alt)', boxShadow: 'var(--shadow-md)', padding: '8px 12px', fontSize: 13, lineHeight: 1.55 }}>
    <div className="flex items-center gap-2 text-[12px] text-on-surface-muted">
      <span className="font-semibold text-on-surface">코치</span>
      {working && <span>이 장을 준비하는 중…</span>}
      <button className="ml-auto" aria-expanded={open} onClick={() => setCollapsed(value => ({ ...value, [chapterKey]: open }))}>{open ? '접기' : '펼치기'}</button>
      <button aria-label="이 장에서 닫기" onClick={() => setHidden(value => ({ ...value, [chapterKey]: true }))}>✕</button>
    </div>
    {open && items.length > 0 && <div className="mt-2 flex flex-col gap-3 text-on-surface">{items}</div>}
  </aside>
}
