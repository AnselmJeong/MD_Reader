import { RefObject, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { COACH_KIND_LABELS, coachImageKey, type CoachCard as CoachCardData, type CoachDeck, type CoachImage, type CoachImageCandidate } from '../../../../shared/coach'
import { askCoachMore, insertCoachCard, markCardKnown, markKindUnwanted } from './utils/coachActions'
import { useCoachStore } from '../../store/useCoachStore'

/** Phase 5: where else the reader met this term, and their own notes about it. */
export function CoachCardConnections({ card }: { card: CoachCardData }) {
  const links = useCoachStore(state => state.links)
  const { encounters, personal } = useMemo(() => {
    const values = Object.values(links)
    return {
      encounters: values.flatMap(value => value.encounters[card.id] ?? []).slice(0, 3),
      personal: values.flatMap(value => value.personal.filter(item => item.cardId === card.id && item.source === 'commentary')).slice(0, 2)
    }
  }, [links, card.id])
  if (!encounters.length && !personal.length) return null
  return <div className="mt-2 flex flex-col gap-1 border-t border-[var(--hair-2)] pt-2 text-[12px] text-on-surface-muted">
    {encounters.map(item => <p key={`${item.documentId}:${item.title}`}>다른 책에서도 만났어요: 《{item.bookTitle}》{item.chapterLabel ? ` ${item.chapterLabel}` : ''}{item.known ? ' · 그때 "이미 알아요"' : ''}</p>)}
    {personal.map(item => <p key={`${item.source}:${item.at}`}>
      {`내 주석 (${item.bookTitle})`}{item.excerpt ? ` — ${item.excerpt}` : ''}
    </p>)}
  </div>
}

const imageRequests = new Map<string, Promise<CoachImage>>()
const imageEvents = new EventTarget()
/** Pictures are fetched only for cards the reader opens, once per card. */
export function loadCoachImage(card: CoachCardData): Promise<CoachImage> {
  const key = coachImageKey(card)
  let request = imageRequests.get(key)
  if (!request) {
    request = window.api.coach.getImage({ title: card.title, imageQuery: card.imageQuery }).catch(() => ({ status: 'none' as const }))
    imageRequests.set(key, request)
  }
  return request
}

function setCoachImage(card: CoachCardData, image: CoachImage) {
  const key = coachImageKey(card)
  imageRequests.set(key, Promise.resolve(image))
  imageEvents.dispatchEvent(new CustomEvent('change', { detail: { key, image } }))
}

export function useCoachImage(card: CoachCardData | null) {
  const [image, setImage] = useState<CoachImage | null>(null)
  const key = card ? coachImageKey(card) : ''
  useEffect(() => {
    setImage(null)
    if (!card) return
    let active = true
    void loadCoachImage(card).then(result => { if (active) setImage(result) })
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; image: CoachImage }>).detail
      if (active && detail.key === key) setImage(detail.image)
    }
    imageEvents.addEventListener('change', onChange)
    return () => { active = false; imageEvents.removeEventListener('change', onChange) }
  }, [card?.id, key])
  return image
}

/** Picture picker: edit the search phrase, compare three candidates, keep one. */
export function CoachImagePicker({ card, onClose }: { card: CoachCardData; onClose: () => void }) {
  const [query, setQuery] = useState(card.imageQuery || card.title)
  const [candidates, setCandidates] = useState<CoachImageCandidate[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const search = async () => {
    if (!query.trim()) return
    setBusy(true); setStatus('그림을 찾는 중…'); setSelected(null)
    try {
      const result = await window.api.coach.searchImages(query)
      setCandidates(result.candidates)
      setStatus(result.candidates.length ? (result.warning ?? '') : (result.warning ?? '맞는 그림을 찾지 못했습니다.'))
    } catch (error) { setCandidates([]); setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void search() }, [])
  const save = async () => {
    if (selected === null || !candidates[selected]) return
    setBusy(true)
    try { setCoachImage(card, await window.api.coach.saveImage({ title: card.title, imageQuery: card.imageQuery }, candidates[selected])); onClose() }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="mb-2 rounded border border-border p-2 text-[12px]">
    <form className="flex gap-1" onSubmit={event => { event.preventDefault(); void search() }}>
      <input aria-label="그림 검색어" value={query} onChange={event => setQuery(event.target.value)}
        className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-[12px] text-on-surface" />
      <button type="submit" disabled={busy || !query.trim()} className="rounded px-2 py-1 hover:bg-[var(--ink-3)]">검색</button>
    </form>
    {candidates.length > 0 && <div className="mt-2 grid grid-cols-3 gap-1">
      {candidates.map((candidate, index) => (
        <button key={candidate.dataUrl.slice(-48) + index} type="button" aria-pressed={selected === index} title={candidate.title}
          onClick={() => setSelected(index)}
          className={`flex flex-col overflow-hidden rounded border text-left ${selected === index ? 'border-accent ring-1 ring-[var(--color-accent)]' : 'border-border'}`}>
          <img src={candidate.dataUrl} alt={candidate.title} className="h-[72px] w-full object-cover" />
          <span className="truncate px-1 py-0.5 text-[10px] text-on-surface-muted">{candidate.source}</span>
        </button>
      ))}
    </div>}
    {status && <p role="status" className="mt-1 text-on-surface-muted">{status}</p>}
    <div className="mt-2 flex justify-end gap-1">
      <button type="button" className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" onClick={onClose}>취소</button>
      <button type="button" disabled={busy || selected === null} className="rounded px-2 py-1 font-semibold text-accent hover:bg-[var(--ink-3)] disabled:opacity-50" onClick={() => void save()}>저장</button>
    </div>
  </div>
}

export function CoachCardBody({ card, deck, image, onDone, compact = false }: { card: CoachCardData; deck: CoachDeck; image: CoachImage | null; onDone?: () => void; compact?: boolean }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  useEffect(() => { setPicking(false) }, [card.id])
  const run = async (action: () => Promise<unknown>, done = true) => {
    setBusy(true)
    try {
      const message = await action()
      if (typeof message === 'string') setStatus(message)
      else if (done) onDone?.()
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const ready = image?.status === 'ready' && Boolean(image.dataUrl)
  // While a card's picture is still loading, hold its place so the reader knows one is coming.
  const loading = !image && Boolean(card.imageQuery)
  return <>
    {!compact && picking && <CoachImagePicker card={card} onClose={() => setPicking(false)} />}
    {!compact && !picking && ready && (
      <img src={image!.dataUrl} alt={image!.pageTitle ?? card.title} className="mb-2 max-h-[180px] w-full rounded object-cover" />
    )}
    {!compact && !picking && loading && (
      <div role="status" aria-label="그림을 불러오는 중" className="mb-2 flex h-[120px] w-full animate-pulse items-center justify-center rounded bg-[var(--ink-3)] text-[11px] text-on-surface-muted">그림을 불러오는 중…</div>
    )}
    <div className="mb-1 flex items-center gap-2 text-[11px] text-on-surface-muted">
      <span className="rounded border border-border px-1.5 py-0.5">{COACH_KIND_LABELS[card.kind]}</span>
      <span>난이도 {card.difficulty}</span>
      <span className="ml-auto">AI 코치</span>
    </div>
    <p className="text-[14px] font-semibold text-on-surface">{card.title}</p>
    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface">{card.gloss}</p>
    <CoachCardConnections card={card} />
    {ready && image!.pageUrl && (
      <a href={image!.pageUrl} className="mt-1 block truncate text-[11px] text-on-surface-muted hover:underline" title={image!.pageTitle}
        onClick={event => { event.preventDefault(); void window.api.shell.openExternal(image!.pageUrl!) }}>그림: {image!.source ?? 'Wikipedia'}{image!.pageTitle ? ` — ${image!.pageTitle}` : ''} ↗</a>
    )}
    <div className="mt-2 flex flex-wrap gap-1 text-[12px]">
      <button disabled={busy} className="rounded px-2 py-1 font-semibold text-accent hover:bg-[var(--ink-3)]" onClick={() => void run(() => askCoachMore(card, deck))}>더 자세히</button>
      <button disabled={busy} className="rounded px-2 py-1 hover:bg-[var(--ink-3)]" onClick={() => void run(() => insertCoachCard(card, deck, image), false)}>EPUB에 넣기</button>
      {!compact && <button disabled={busy} className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" onClick={() => setPicking(value => !value)}>{ready ? '그림 바꾸기' : '그림 찾기'}</button>}
      <button disabled={busy} className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" title="너무 쉬운 카드는 덜 보여 줍니다" onClick={() => void run(() => markCardKnown(card, deck))}>이미 알아요</button>
      <button disabled={busy} className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" title={`"${COACH_KIND_LABELS[card.kind]}" 카드를 덜 보여 줍니다`} onClick={() => void run(() => markKindUnwanted(card, deck))}>이런 건 그만</button>
    </div>
    {status && <p role="status" className="mt-1 text-[12px] text-on-surface-muted">{status}</p>}
  </>
}

/** Shown at the selection while the coach writes a card the reader asked for. */
export function CoachPendingCard({ rect, text, error, onClose }: { rect: DOMRect; text: string; error?: string; onClose: () => void }) {
  const width = 340
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
  const top = rect.bottom + 140 <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - 140)
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div role={error ? 'alert' : 'status'} aria-live="polite" data-selection-menu="true" data-commentary-ui
      className="fixed z-50 rounded-md border border-border px-3 py-3 ui-text"
      style={{ top, left, width, maxWidth: 'calc(100vw - 16px)', background: 'var(--color-surface-alt)', boxShadow: 'var(--shadow-md)' }}>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-on-surface-muted"><span>AI 코치 · 내가 요청한 카드</span>
        <button className="ml-auto rounded px-1 hover:bg-[var(--ink-3)]" aria-label="닫기" onClick={onClose}>✕</button></div>
      <p className="line-clamp-2 text-[13px] font-semibold text-on-surface">{text}</p>
      {error
        ? <p className="mt-1 text-[12px] text-on-surface-muted">{error}</p>
        : <div className="mt-2 flex flex-col gap-1.5" aria-label="코치가 카드를 쓰는 중">
            <p className="text-[12px] text-on-surface-muted">코치가 카드를 쓰는 중…</p>
            <div className="h-2.5 w-full animate-pulse rounded bg-[var(--ink-3)]" />
            <div className="h-2.5 w-5/6 animate-pulse rounded bg-[var(--ink-3)]" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-[var(--ink-3)]" />
          </div>}
    </div>,
    document.body
  )
}

/** Wikipedia-style hover preview for a coach mark. */
export function CoachHoverCard({ card, deck, rect, cardRef, onPointerEnter, onPointerLeave, onClose }: {
  card: CoachCardData; deck: CoachDeck; rect: DOMRect; cardRef: RefObject<HTMLDivElement | null>
  onPointerEnter: () => void; onPointerLeave: () => void; onClose: () => void
}) {
  const image = useCoachImage(card)
  const [position, setPosition] = useState({ top: rect.bottom + 6, left: rect.left })
  useLayoutEffect(() => {
    const bounds = cardRef.current?.getBoundingClientRect()
    if (!bounds) return
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8))
    const top = rect.bottom + bounds.height + 6 <= window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - bounds.height - 6)
    setPosition({ top, left })
  }, [rect, image, cardRef])
  return createPortal(
    <div ref={cardRef} role="dialog" aria-label={`코치 카드: ${card.title}`} data-selection-menu="true" data-commentary-ui
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}
      className="fixed z-50 w-[340px] rounded-md border border-border px-3 py-3 ui-text"
      style={{ ...position, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', background: 'var(--color-surface-alt)', boxShadow: 'var(--shadow-md)' }}>
      <CoachCardBody card={card} deck={deck} image={image} onDone={onClose} />
    </div>,
    document.body
  )
}
