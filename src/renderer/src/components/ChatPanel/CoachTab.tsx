import { useEffect, useMemo, useState } from 'react'
import {
  COACH_FAMILIARITY, COACH_KIND_LABELS, COACH_PROACTIVITY, COACH_PURPOSES, estimatedLevels, selectCoachCards,
  type CoachCard, type CoachDeck
} from '../../../../shared/coach'
import { currentChapterDecks, currentChapterStatus, useCoachStore } from '../../store/useCoachStore'
import { CoachCardBody, useCoachImage } from '../DocumentReader/CoachCard'

function CardRow({ card, deck, shown }: { card: CoachCard; deck: CoachDeck; shown: boolean }) {
  const [open, setOpen] = useState(false)
  const image = useCoachImage(open ? card : null)
  return <li className="border-b border-[var(--hair-2)] py-2">
    <button className="flex w-full items-baseline gap-2 text-left" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="shrink-0 rounded border border-border px-1 text-[10px] text-on-surface-muted">{COACH_KIND_LABELS[card.kind]}</span>
      <span className="font-medium text-on-surface">{card.title}</span>
      <span className="ml-auto shrink-0 text-[11px] text-on-surface-muted">{shown ? '본문 표시' : '숨김'} · {card.difficulty}</span>
    </button>
    {open && <div className="mt-2 pl-1"><CoachCardBody card={card} deck={deck} image={image} /></div>}
  </li>
}

/** The coach tab lists every card of the chapter, including ones filtered out of the text. */
export function CoachTab() {
  const preferences = useCoachStore(state => state.preferences)
  const profile = useCoachStore(state => state.profile)
  const suppressed = useCoachStore(state => state.suppressed)
  const usage = useCoachStore(state => state.usage)
  const documentId = useCoachStore(state => state.documentId)
  const chapterHref = useCoachStore(state => state.chapterHref)
  const chapterLabel = useCoachStore(state => state.chapterLabel)
  const deckMap = useCoachStore(state => state.decks)
  const prepareCurrent = useCoachStore(state => state.prepareCurrent)
  const decks = useMemo(() => currentChapterDecks({ documentId, chapterHref, decks: deckMap }), [documentId, chapterHref, deckMap])
  const status = useMemo(() => currentChapterStatus({ documentId, chapterHref, decks: deckMap }), [documentId, chapterHref, deckMap])
  const [filter, setFilter] = useState<'all' | 'shown'>('all')

  useEffect(() => { void useCoachStore.getState().refreshUsage() }, [status?.status])
  // "부를 때만" builds the deck the first time the tab is opened for a chapter.
  useEffect(() => {
    if (preferences?.enabled && preferences.proactivity === 'onDemand' && !decks.length && status?.status === 'idle') prepareCurrent?.(false)
  }, [preferences?.enabled, preferences?.proactivity, chapterHref, prepareCurrent, decks.length, status?.status])

  if (!documentId) return <p className="p-5 text-sm text-on-surface-muted">EPUB을 열면 코치를 쓸 수 있습니다.</p>
  const label = (list: Array<{ id: string; label: string }>, id?: string) => list.find(item => item.id === id)?.label ?? ''
  const levels = estimatedLevels(profile)
  const working = status?.status === 'generating' || status?.status === 'queued'

  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-[13px]">
    <section className="flex flex-col gap-1">
      {preferences?.enabled
        ? <p className="text-on-surface">{label(COACH_PURPOSES, preferences.purpose)} · {label(COACH_FAMILIARITY, preferences.familiarity)} · {label(COACH_PROACTIVITY, preferences.proactivity === 'active' ? 'suggest' : preferences.proactivity)}</p>
        : <p className="text-on-surface-muted">이 책에서는 코치가 꺼져 있습니다.</p>}
      {preferences?.request && <p className="text-on-surface-muted">부탁: {preferences.request}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="font-semibold text-accent" onClick={() => useCoachStore.getState().setIntakeOpen(true)}>{preferences?.enabled ? '코칭 설정 바꾸기' : '코치 켜기'}</button>
        {preferences?.enabled && <button disabled={working} className="text-on-surface-muted disabled:opacity-50" onClick={() => prepareCurrent?.(decks.length > 0)}>{decks.length ? '이 장 다시 준비' : '이 장 준비'}</button>}
      </div>
    </section>

    <section>
      <p className="small-caps mb-1 text-on-surface-muted">{chapterLabel || '현재 장'}</p>
      {working && <p className="text-on-surface-muted">코치가 이 장을 준비하는 중입니다. 다른 일을 하셔도 됩니다.</p>}
      {(status?.status === 'error' || status?.status === 'limited') && <p role="status" className="text-on-surface-muted">{status.error}</p>}
      {!working && !decks.length && status?.status !== 'error' && status?.status !== 'limited' && preferences?.enabled &&
        <p className="text-on-surface-muted">이 장에 잠시 머물면 코치가 카드를 준비합니다.</p>}
    </section>

    {decks.map(deck => {
      const shownIds = new Set(selectCoachCards(deck, preferences, profile, { suppressed, day: new Date().toDateString() }).map(item => item.card.id))
      const cards = filter === 'shown' ? deck.cards.filter(card => shownIds.has(card.id)) : deck.cards
      return <section key={deck.key} className="flex flex-col gap-2">
        {deck.brief && <div><p className="small-caps mb-1 text-on-surface-muted">이 장을 읽기 전에</p><p className="whitespace-pre-wrap text-on-surface">{deck.brief}</p></div>}
        <div className="flex items-center gap-2">
          <p className="small-caps text-on-surface-muted">카드 {deck.cards.length}장{decks.length > 1 ? ` · ${deck.part + 1}부` : ''}</p>
          <select className="ml-auto text-[12px]" value={filter} onChange={event => setFilter(event.target.value as 'all' | 'shown')} aria-label="카드 거르기">
            <option value="all">전체</option><option value="shown">본문에 표시된 것</option>
          </select>
        </div>
        <ul>{cards.map(card => <CardRow key={card.id} card={card} deck={deck} shown={shownIds.has(card.id)} />)}</ul>
        {deck.sections.length > 0 && <div><p className="small-caps mb-1 text-on-surface-muted">절 요약</p>
          <ul className="flex flex-col gap-1.5">{deck.sections.map(section => <li key={section.quote}><span className="italic text-on-surface-muted">{section.quote}</span> — {section.summary}</li>)}</ul></div>}
        {deck.recap.length > 0 && <div><p className="small-caps mb-1 text-on-surface-muted">이 장 정리</p><ul className="list-disc pl-4">{deck.recap.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {deck.questions.length > 0 && <div><p className="small-caps mb-1 text-on-surface-muted">스스로 확인해 볼 질문</p><ol className="list-decimal pl-4">{deck.questions.map(item => <li key={item}>{item}</li>)}</ol></div>}
        <p className="text-[11px] text-on-surface-muted">AI가 만든 카드입니다. 본문과 맞지 않는 항목 {deck.dropped}개는 버렸습니다.</p>
      </section>
    })}

    <section className="flex flex-col gap-1 border-t border-[var(--hair-2)] pt-3">
      <p className="small-caps text-on-surface-muted">코치가 추정한 수준</p>
      {levels.length ? <ul>{levels.slice(0, 5).map(level => <li key={level.domain}>{level.domain}: {level.level <= 2 ? '입문' : level.level < 4 ? '중급' : '심화'} <span className="text-on-surface-muted">(근거 {level.evidence})</span></li>)}</ul>
        : <p className="text-on-surface-muted">아직 기록이 없습니다. 카드의 "이미 알아요", "이런 건 그만"을 누르면 맞춰 갑니다.</p>}
      <p className="text-[11px] text-on-surface-muted">직접 고른 설정이 항상 우선합니다. 기록은 이 기기에만 남습니다.</p>
      {levels.length > 0 && <button className="self-start text-on-surface-muted underline" onClick={() => void useCoachStore.getState().resetProfile()}>추정 초기화</button>}
    </section>

    {usage && <p className="text-[11px] text-on-surface-muted">오늘 코치 호출 {usage.calls}회 · 캐시에서 해결 {usage.cacheHits}회{usage.failures ? ` · 실패 ${usage.failures}회` : ''}</p>}
  </div>
}
