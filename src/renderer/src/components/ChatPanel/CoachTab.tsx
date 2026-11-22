import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, BookOpenCheck, CheckCircle2, ChevronDown, FileDown, GraduationCap, Hourglass, Link2, Loader2, RefreshCw, RotateCcw, Settings2, Sparkles } from 'lucide-react'
import {
  COACH_FAMILIARITY, COACH_KIND_LABELS, COACH_PROACTIVITY, COACH_PURPOSES, estimatedLevels, isUserDeck, selectCoachCards,
  type CoachCard, type CoachDeck
} from '../../../../shared/coach'
import { currentChapterDecks, currentChapterStatus, linksKey, useCoachStore } from '../../store/useCoachStore'
import { CoachCardBody, loadCoachImage, useCoachImage } from '../DocumentReader/CoachCard'
import { askReviewAnswer, insertCoachCard } from '../DocumentReader/utils/coachActions'
import './coach-tab.css'

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

function SectionTitle({ icon, children, aside }: { icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return <div className="coach-section-title">{icon}<span className="small-caps">{children}</span>{aside && <span className="coach-section-aside">{aside}</span>}</div>
}

function ReviewList() {
  const reviews = useCoachStore(state => state.reviews)
  const answerReview = useCoachStore(state => state.answerReview)
  useEffect(() => { void useCoachStore.getState().loadReviews() }, [])
  if (!reviews.length) return null
  return <section className="coach-panel">
    <SectionTitle icon={<RotateCcw />} aside={`${reviews.length}개`}>오늘 복습할 질문</SectionTitle>
    <ul className="coach-review-list">{reviews.map(item => <li key={item.id}>
      <span className="coach-meta">《{item.bookTitle}》 {item.chapterLabel}</span>
      <span className="text-on-surface">{item.question}</span>
      <div className="coach-review-actions">
        <button className="coach-chip-button is-primary" onClick={() => void answerReview(item.id, true)}>기억나요</button>
        <button className="coach-chip-button" onClick={() => void answerReview(item.id, false)}>가물가물해요</button>
        <button className="coach-chip-button" onClick={() => void askReviewAnswer(item)}>답 확인</button>
      </div>
    </li>)}</ul>
    <p className="coach-footnote">기억나면 1, 3, 7, 16, 35일 간격으로 늘어나고, 가물가물하면 내일 다시 나옵니다.</p>
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
  const personal = (links?.personal ?? []).filter(item => item.source === 'commentary')
  if (!encounters.length && !personal.length && !memory?.items.length && !loading && memory?.status !== 'error') return null
  return <section className="coach-panel">
    <SectionTitle icon={<Link2 />}>내 독서 이력과의 연결</SectionTitle>
    {encounters.length > 0 && <div className="coach-block"><p className="coach-subhead">다른 책에서도 만난 용어</p>
      <ul className="coach-bullets">{encounters.slice(0, 8).map(([id, items]) => <li key={id}><span className="font-medium">{cardTitle(id)}</span> — {items.map(item => `《${item.bookTitle}》`).join(', ')}</li>)}</ul></div>}
    {personal.length > 0 && <div className="coach-block"><p className="coach-subhead">내 주석</p>
      <ul className="flex flex-col gap-2">{personal.slice(0, 6).map(item => <li key={`${item.source}:${item.at}`}>
        <span className="font-medium">{cardTitle(item.cardId)}</span> · {`내 주석 (${item.bookTitle})`}
        {item.excerpt && <span className="coach-excerpt">{item.excerpt}</span>}
      </li>)}</ul></div>}
    {loading && <p className="coach-inline-status"><Loader2 className="coach-spin" />장기 기억에서 연결을 찾는 중…</p>}
    {memory?.items.length ? <div className="coach-block"><p className="coach-subhead">장기 기억(Hindsight)에서</p>
      <ul className="coach-bullets">{memory.items.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
    {memory?.status === 'error' && <p className="coach-footnote">장기 기억에 연결하지 못했습니다: {memory.error}</p>}
  </section>
}

function CardRow({ card, deck, shown }: { card: CoachCard; deck: CoachDeck; shown: boolean }) {
  const [open, setOpen] = useState(false)
  const image = useCoachImage(open ? card : null)
  return <li className="coach-card-row" data-open={open || undefined}>
    <button className="coach-card-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="coach-kind">{COACH_KIND_LABELS[card.kind]}</span>
      <span className="coach-card-title">{card.title}</span>
      <span className="coach-card-meta"><span className={shown ? 'coach-dot is-on' : 'coach-dot'} aria-hidden />{shown ? '본문' : '숨김'} · {card.from ? (card.from.gloss ? '보충' : '앞 장') : card.difficulty}</span>
      <ChevronDown className="coach-chevron" aria-hidden />
    </button>
    {open && <div className="coach-card-body"><CoachCardBody card={card} deck={deck} image={image} /></div>}
  </li>
}

/** Spinner, indeterminate bar and per-part progress while the chapter's decks are built. */
function PreparingStatus({ queued, done, total }: { queued: boolean; done: number; total: number }) {
  return <div className="coach-preparing" role="status" aria-live="polite">
    <div className="coach-preparing-row">
      <span className="coach-spinner" aria-hidden>{queued ? <Hourglass /> : <Loader2 className="coach-spin" />}</span>
      <div className="min-w-0 flex-1">
        <p className="coach-preparing-title">{queued ? '준비 순서를 기다리는 중' : '코치가 이 장을 읽고 카드를 만드는 중'}<span className="coach-ellipsis" aria-hidden /></p>
        <p className="coach-preparing-detail">다른 일을 하셔도 됩니다. 준비가 끝나면 여기에 카드가 나타납니다.</p>
      </div>
    </div>
    <div className="coach-progress" aria-hidden><span /></div>
    {total > 1 && <p className="coach-preparing-parts">{total}부 중 {done}부 완료</p>}
  </div>
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
  const parts = useMemo(() => {
    if (!documentId || !chapterHref) return { done: 0, total: 0 }
    const prefix = `${documentId}|${chapterHref}#`
    const updates = Object.entries(deckMap).filter(([slot, update]) => slot.startsWith(prefix) && !(update.deck && isUserDeck(update.deck))).map(([, update]) => update)
    return { done: updates.filter(update => update.status === 'ready').length, total: updates.length }
  }, [documentId, chapterHref, deckMap])
  const [filter, setFilter] = useState<'all' | 'shown'>('all')
  const [insertStatus, setInsertStatus] = useState('')
  const [inserting, setInserting] = useState(false)
  const bookTitle = useCoachStore(state => state.bookTitle)

  useEffect(() => { void useCoachStore.getState().refreshUsage() }, [status?.status])
  // "부를 때만" builds the deck the first time the tab is opened for a chapter.
  useEffect(() => {
    if (preferences?.enabled && preferences.proactivity === 'onDemand' && !decks.some(deck => !isUserDeck(deck)) && status?.status === 'idle') prepareCurrent?.(false)
  }, [preferences?.enabled, preferences?.proactivity, chapterHref, prepareCurrent, decks.length, status?.status])

  if (!documentId) return <div className="coach-tab"><div className="coach-empty"><span className="coach-empty-icon"><GraduationCap /></span><p>EPUB을 열면 코치를 쓸 수 있습니다.</p></div></div>
  const label = (list: Array<{ id: string; label: string }>, id?: string) => list.find(item => item.id === id)?.label ?? ''
  const levels = estimatedLevels(profile)
  const working = status?.status === 'generating' || status?.status === 'queued'
  const failed = status?.status === 'error' || status?.status === 'limited'
  const generatedDecks = decks.filter(deck => !isUserDeck(deck))
  const cardCount = generatedDecks.reduce((sum, deck) => sum + deck.cards.length, 0)
  const chips = preferences?.enabled
    ? [label(COACH_PURPOSES, preferences.purpose), label(COACH_FAMILIARITY, preferences.familiarity), label(COACH_PROACTIVITY, preferences.proactivity === 'active' ? 'suggest' : preferences.proactivity)].filter(Boolean)
    : []

  return <div className="coach-tab">
    <section className="coach-panel coach-hero">
      <div className="coach-hero-head">
        <span className="coach-mark" aria-hidden><GraduationCap /></span>
        <div className="min-w-0 flex-1">
          <p className="coach-hero-title">독서 코치</p>
          <p className="coach-meta">{preferences?.enabled ? '이 책에 맞춰 카드를 준비합니다' : '이 책에서는 코치가 꺼져 있습니다'}</p>
        </div>
        <span className={preferences?.enabled ? 'coach-pill is-on' : 'coach-pill'}>{preferences?.enabled ? '켜짐' : '꺼짐'}</span>
      </div>
      {chips.length > 0 && <ul className="coach-chips" aria-label="코칭 설정">{chips.map(chip => <li key={chip}>{chip}</li>)}</ul>}
      {preferences?.request && <blockquote className="coach-request"><span className="small-caps">부탁</span>{preferences.request}</blockquote>}
      <div className="coach-actions">
        <button className="coach-button is-primary" onClick={() => useCoachStore.getState().setIntakeOpen(true)}>
          {preferences?.enabled ? <Settings2 /> : <Sparkles />}{preferences?.enabled ? '코칭 설정 바꾸기' : '코치 켜기'}
        </button>
        {preferences?.enabled && <button disabled={working} className="coach-button" onClick={() => prepareCurrent?.(generatedDecks.length > 0)}>
          {working ? <Loader2 className="coach-spin" /> : <RefreshCw />}{working ? '준비 중' : generatedDecks.length ? '이 장 다시 준비' : '이 장 준비'}
        </button>}
      </div>
    </section>

    <section className="coach-panel">
      <SectionTitle icon={<BookOpenCheck />}>현재 장</SectionTitle>
      <p className="coach-chapter">{chapterLabel || '제목 없는 장'}</p>
      {working && <PreparingStatus queued={status?.status === 'queued'} done={parts.done} total={parts.total} />}
      {failed && <p role="status" className="coach-alert"><AlertCircle />{status?.error || '코치가 이 장을 준비하지 못했습니다.'}</p>}
      {!working && !failed && generatedDecks.length > 0 && <p className="coach-inline-status is-ready"><CheckCircle2 />카드 {cardCount}장 준비됨</p>}
      {!working && !generatedDecks.length && !failed && preferences?.enabled &&
        <p className="coach-hint">이 장에 잠시 머물면 코치가 카드를 준비합니다. 바로 받으려면 "이 장 준비"를 누르세요.</p>}
    </section>

    {decks.map(deck => {
      const mine = isUserDeck(deck)
      const shownIds = new Set(mine ? deck.cards.filter(card => !suppressed.has(card.id)).map(card => card.id)
        : selectCoachCards(deck, preferences, profile, { suppressed, day: new Date().toDateString() }).map(item => item.card.id))
      const cards = filter === 'shown' ? deck.cards.filter(card => shownIds.has(card.id)) : deck.cards
      if (mine) return <section key={deck.key} className="coach-panel">
        <SectionTitle icon={<Sparkles />}>내가 요청한 카드 {deck.cards.length}장</SectionTitle>
        <ul className="coach-card-list">{deck.cards.slice().reverse().map(card => <CardRow key={card.id} card={card} deck={deck} shown={shownIds.has(card.id)} />)}</ul>
        <p className="coach-footnote">본문에서 글을 선택하고 "코치 카드"를 누르면 여기에 쌓입니다.</p>
      </section>
      return <section key={deck.key} className="coach-panel">
        {deck.brief && <div className="coach-brief"><SectionTitle icon={<Sparkles />}>이 장을 읽기 전에</SectionTitle><p className="whitespace-pre-wrap">{deck.brief}</p></div>}
        <SectionTitle aside={<select className="coach-select" value={filter} onChange={event => setFilter(event.target.value as 'all' | 'shown')} aria-label="카드 거르기">
          <option value="all">전체</option><option value="shown">본문에 표시된 것</option>
        </select>}>카드 {deck.cards.length}장{generatedDecks.length > 1 ? ` · ${deck.part + 1}부` : ''}</SectionTitle>
        <ul className="coach-card-list">{cards.map(card => <CardRow key={card.id} card={card} deck={deck} shown={shownIds.has(card.id)} />)}</ul>
        {deck.sections.length > 0 && <div className="coach-block"><p className="coach-subhead">절 요약</p>
          <ul className="flex flex-col gap-2">{deck.sections.map(section => <li key={section.quote}><span className="coach-quote">{section.quote}</span> {section.summary}</li>)}</ul></div>}
        {deck.recap.length > 0 && <div className="coach-block"><p className="coach-subhead">이 장 정리</p><ul className="coach-bullets">{deck.recap.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {deck.questions.length > 0 && <div className="coach-block"><p className="coach-subhead">스스로 확인해 볼 질문</p><ol className="coach-numbered">{deck.questions.map(item => <li key={item}>{item}</li>)}</ol></div>}
        <p className="coach-footnote">AI가 만든 카드입니다. 본문과 맞지 않는 항목 {deck.dropped}개는 버렸습니다.</p>
      </section>
    })}

    {decks.length > 0 && chapterHref && <section className="coach-panel coach-export">
      <button disabled={inserting} className="coach-button" onClick={() => {
        setInserting(true)
        void insertOpenedCards(documentId, chapterHref, decks).then(setInsertStatus, error => setInsertStatus(String(error))).finally(() => setInserting(false))
      }}>{inserting ? <Loader2 className="coach-spin" /> : <FileDown />}이 장에서 열어 본 카드 모두 EPUB에 넣기</button>
      {insertStatus && <p role="status" className="coach-footnote">{insertStatus}</p>}
    </section>}

    {decks.length > 0 && <ChapterConnections decks={decks} bookTitle={bookTitle} chapterTitle={chapterLabel ?? ''} />}
    <ReviewList />

    <section className="coach-panel">
      <SectionTitle icon={<GraduationCap />} aside={levels.length > 0 && <button className="coach-link" onClick={() => void useCoachStore.getState().resetProfile()}>추정 초기화</button>}>코치가 추정한 수준</SectionTitle>
      {levels.length ? <ul className="coach-levels">{levels.slice(0, 5).map(level => {
        const tier = level.level <= 2 ? '입문' : level.level < 4 ? '중급' : '심화'
        return <li key={level.domain}><span className="coach-level-domain">{level.domain}</span><span className="coach-level-tier" data-tier={tier}>{tier}</span><span className="coach-meta">근거 {level.evidence}</span></li>
      })}</ul>
        : <p className="coach-hint">아직 기록이 없습니다. 카드의 "이미 알아요", "이런 건 그만"을 누르면 맞춰 갑니다.</p>}
      <p className="coach-footnote">직접 고른 설정이 항상 우선합니다. 기록은 이 기기에만 남습니다.</p>
    </section>

    {usage && <dl className="coach-usage">
      <div><dt>오늘 호출</dt><dd>{usage.calls}</dd></div>
      <div><dt>캐시</dt><dd>{usage.cacheHits}</dd></div>
      {usage.failures > 0 && <div className="is-warn"><dt>실패</dt><dd>{usage.failures}</dd></div>}
    </dl>}
  </div>
}
