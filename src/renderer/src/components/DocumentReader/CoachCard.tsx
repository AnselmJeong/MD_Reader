import { RefObject, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { COACH_KIND_LABELS, type CoachCard as CoachCardData, type CoachDeck, type CoachImage } from '../../../../shared/coach'
import { askCoachMore, insertCoachCard, markCardKnown, markKindUnwanted } from './utils/coachActions'

const imageRequests = new Map<string, Promise<CoachImage>>()
/** Pictures are fetched only for cards the reader opens, once per search phrase. */
export function loadCoachImage(card: CoachCardData): Promise<CoachImage> {
  if (!card.imageQuery) return Promise.resolve({ status: 'none' })
  const key = card.imageQuery.toLowerCase()
  let request = imageRequests.get(key)
  if (!request) {
    request = window.api.coach.getImage({ title: card.title, imageQuery: card.imageQuery }).catch(() => ({ status: 'none' as const }))
    imageRequests.set(key, request)
  }
  return request
}

export function useCoachImage(card: CoachCardData | null) {
  const [image, setImage] = useState<CoachImage | null>(null)
  useEffect(() => {
    setImage(null)
    if (!card?.imageQuery) return
    let active = true
    void loadCoachImage(card).then(result => { if (active) setImage(result) })
    return () => { active = false }
  }, [card?.id, card?.imageQuery])
  return image
}

export function CoachCardBody({ card, deck, image, onDone, compact = false }: { card: CoachCardData; deck: CoachDeck; image: CoachImage | null; onDone?: () => void; compact?: boolean }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>, done = true) => {
    setBusy(true)
    try {
      const message = await action()
      if (typeof message === 'string') setStatus(message)
      else if (done) onDone?.()
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <>
    {!compact && card.imageQuery && image?.status !== 'none' && image?.status !== 'unavailable' && (
      image?.status === 'ready' && image.dataUrl
        ? <img src={image.dataUrl} alt={image.pageTitle ?? card.title} className="mb-2 max-h-[180px] w-full rounded object-cover" />
        : <div aria-hidden="true" className="mb-2 h-[120px] w-full animate-pulse rounded bg-[var(--ink-3)]" />
    )}
    <div className="mb-1 flex items-center gap-2 text-[11px] text-on-surface-muted">
      <span className="rounded border border-border px-1.5 py-0.5">{COACH_KIND_LABELS[card.kind]}</span>
      <span>난이도 {card.difficulty}</span>
      <span className="ml-auto">AI 코치 · 이 책의 맥락에서</span>
    </div>
    <p className="text-[14px] font-semibold text-on-surface">{card.title}</p>
    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-on-surface">{card.gloss}</p>
    {image?.status === 'ready' && image.pageUrl && (
      <a href={image.pageUrl} className="mt-1 block text-[11px] text-on-surface-muted hover:underline"
        onClick={event => { event.preventDefault(); void window.api.shell.openExternal(image.pageUrl!) }}>그림: Wikipedia — {image.pageTitle} ↗</a>
    )}
    <div className="mt-2 flex flex-wrap gap-1 text-[12px]">
      <button disabled={busy} className="rounded px-2 py-1 font-semibold text-accent hover:bg-[var(--ink-3)]" onClick={() => void run(() => askCoachMore(card, deck))}>더 자세히</button>
      <button disabled={busy} className="rounded px-2 py-1 hover:bg-[var(--ink-3)]" onClick={() => void run(() => insertCoachCard(card, deck, image), false)}>EPUB에 넣기</button>
      <button disabled={busy} className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" title="너무 쉬운 카드는 덜 보여 줍니다" onClick={() => void run(() => markCardKnown(card, deck))}>이미 알아요</button>
      <button disabled={busy} className="rounded px-2 py-1 text-on-surface-muted hover:bg-[var(--ink-3)]" title={`"${COACH_KIND_LABELS[card.kind]}" 카드를 덜 보여 줍니다`} onClick={() => void run(() => markKindUnwanted(card, deck))}>이런 건 그만</button>
    </div>
    {status && <p role="status" className="mt-1 text-[12px] text-on-surface-muted">{status}</p>}
  </>
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
