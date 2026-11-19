import { useEffect, useMemo, useState } from 'react'
import {
  COACH_FAMILIARITY, COACH_KIND_LABELS, COACH_PROACTIVITY, COACH_PURPOSES, estimatedLevels, selectCoachCards,
  type CoachCard, type CoachDeck
} from '../../../../shared/coach'
import { currentChapterDecks, currentChapterStatus, linksKey, useCoachStore } from '../../store/useCoachStore'
import { CoachCardBody, loadCoachImage, useCoachImage } from '../DocumentReader/CoachCard'
import { askReviewAnswer, insertCoachCard } from '../DocumentReader/utils/coachActions'

/** "이 장에서 열어 본 카드 모두 EPUB에 넣기": skips cards already saved as notes. */
async function insertOpenedCards(documentId: string, chapterHref: string, decks: CoachDeck[]): Promise<string> {
  const [opened, snapshot] = await Promise.all([window.api.coach.openedCards(documentId, chapterHref), window.api.commentary.list(documentId)])
  const saved = new Set(snapshot.notes.filter(note => !note.deletedAt).map(note => note.origin?.messageId ?? ''))
  const openedIds = new Set(opened)
  const pending = decks.flatMap(deck => deck.cards.filter(card => openedIds.has(card.id) && !saved.has(`coach:${card.id}`)).map(card => ({ card, deck })))
  if (!pending.length) return opened.length ? '열어 본 카드는 이미 모두 주석으로 저장되어 있습니다.' : '이 장에서 아직 열어 본 카드가 없습니다.'
  let done = 0
  let missing = 0
  for (const { card, deck } of pending) {
    try { await insertCoachCard(card, deck, await loadCoachImage(card)); done += 1 }
    catch { missing += 1 }
  }
  return `${done}장을 주석으로 저장했습니다.${missing ? ` ${missing}장은 화면에서 위치를 찾지 못해 건너뛰었습니다(해당 쪽을 연 뒤 다시 누르면 됩니다).` : ''} "주석을 포함한 EPUB 저장"으로 책에 넣을 수 있습니다.`
}

function ReviewList() {
  const reviews = useCoachStore(state => state.reviews)
  const answerReview = useCoachStore(state => state.answerReview)
  useEffect(() => { void useCoachStore.getState().loadReviews() }, [])
  if (!reviews.length) return null
  return <section className="flex flex-col gap-2 border-t border-[var(--hair-2)] pt-3">
    <p className="small-caps text-on-surface-muted">오늘 복습할 질문 {reviews.length}개</p>
    <ul className="flex flex-col gap-3">{reviews.map(item => <li key={item.id} className="flex flex-col gap-1">
      <span className="text-[11px] text-on-surface-muted">《{item.bookTitle}》 {item.chapterLabel}</span>
      <span className="text-on-surface">{item.question}</span>
      <div className="flex flex-wrap gap-3 text-[12px]">
        <button className="font-semibold text-accent" onClick={() => void answerReview(item.id, true)}>기억나요</button>
        <button className="text-on-surface-muted" onClick={() => void answerReview(item.id, false)}>가물가물해요</button>
        <button className="text-on-surface-muted" onClick={() => void askReviewAnswer(item)}>답 확인</button>
      </div>
    </li>)}</ul>
    <p className="text-[11px] text-on-surface-muted">기억나면 1, 3, 7, 16, 35일 간격으로 늘어나고, 가물가물하면 내일 다시 나옵니다.</p>
  </section>
}

function ChapterConnections({ decks, bookTitle, chapterTitle }: { decks: CoachDeck[]; bookTitle: string; chapterTitle: string }) {
  const key = linksKey(decks)
  const links = useCoachStore(state => state.links[key])
  const memory = useCoachStore(state => state.memoryLinks[key])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!decks.length || useCoachStore.getState().memoryLinks[key]) return
    setLoading(true)
    void useCoachStore.getState().loadMemoryLinks(decks, bookTitle, chapterTitle).finally(() => setLoading(false))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const cardTitle = (id: string) => decks.flatMap(deck => deck.cards).find(card => card.id === id)?.title ?? ''
  const encounters = Object.entries(links?.encounters ?? {})
  const personal = links?.personal ?? []
  if (!encounters.length && !personal.length && !memory?.items.length && !loading && memory?.status !== 'error') return null
  return <section className="flex flex-col gap-2 border-t border-[var(--hair-2)] pt-3">
    <p className="small-caps text-on-surface-muted">내 독서 이력과의 연결</p>
    {encounters.length > 0 && <div><p className="text-[12px] text-on-surface-muted">다른 책에서도 만난 용어</p>
      <ul className="list-disc pl-4">{encounters.slice(0, 8).map(([id, items]) => <li key={id}>{cardTitle(id)} — {items.map(item => `《${item.bookTitle}》`).join(', ')}</li>)}</ul></div>}
    {personal.length > 0 && <div><p className="text-[12px] text-on-surface-muted">내 주석과 예전 질문</p>
      <ul className="flex flex-col gap-1.5">{personal.slice(0, 6).map(item => <li key={`${item.source}:${item.at}`}>
        <span className="font-medium">{cardTitle(item.cardId)}</span> · {item.source === 'chat' ? `질문 (${item.bookTitle}): ${item.question}` : `내 주석 (${item.bookTitle})`}
        {item.excerpt && <span className="block text-on-surface-muted">{item.excerpt}</span>}
      </li>)}</ul></div>}
    {loading && <p className="text-on-surface-muted">장기 기억에서 연결을 찾는 중…</p>}
    {memory?.items.length ? <div><p className="text-[12px] text-on-surface-muted">장기 기억(Hindsight)에서</p>
      <ul className="list-disc pl-4">{memory.items.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
    {memory?.status === 'error' && <p className="text-[11px] text-on-surface-muted">장기 기억에 연결하지 못했습니다: {memory.error}</p>}
  </section>
}

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
  const [insertStatus, setInsertStatus] = useState('')
  const [inserting, setInserting] = useState(false)
  const bookTitle = useCoachStore(state => state.bookTitle)

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

    {decks.length > 0 && chapterHref && <section className="flex flex-col gap-1">
      <button disabled={inserting} className="self-start font-semibold text-accent disabled:opacity-50" onClick={() => {
        setInserting(true)
        void insertOpenedCards(documentId, chapterHref, decks).then(setInsertStatus, error => setInsertStatus(String(error))).finally(() => setInserting(false))
      }}>이 장에서 열어 본 카드 모두 EPUB에 넣기</button>
      {insertStatus && <p role="status" className="text-[12px] text-on-surface-muted">{insertStatus}</p>}
    </section>}

    {decks.length > 0 && <ChapterConnections decks={decks} bookTitle={bookTitle} chapterTitle={chapterLabel ?? ''} />}
    <ReviewList />

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
