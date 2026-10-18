import { useEffect, useMemo, useRef } from 'react'
import type { CommentaryAnchor } from '../../../../shared/commentary'
import { commentaryAnchorKey } from '../../../../shared/commentary'
import type { CommentarySection } from './EpubCommentary'
import { COMMENTARY_BLOCKS, COMMENTARY_HOST, resolveSourceAnchor, sourceAnchor } from './utils/epubCommentaryAnchors'

interface Props {
  sections: CommentarySection[]
  candidate: CommentaryAnchor | null
  onChoose: (anchor: CommentaryAnchor) => void
  onConfirm: () => void
  onCancel: () => void
  onNavigate: (anchor: CommentaryAnchor) => void | Promise<void>
  onError: (error: string) => void
}

export function CommentaryPositionPicker({ sections, candidate, onChoose, onConfirm, onCancel, onNavigate, onError }: Props) {
  const panel = useRef<HTMLElement>(null)
  const paragraphs = useMemo(() => sections.flatMap(({ contents, chapterHref }) =>
    Array.from(contents.document.querySelectorAll(COMMENTARY_BLOCKS))
      .filter(block => !block.closest(COMMENTARY_HOST))
      .map(block => sourceAnchor(block, chapterHref))
      .filter((anchor): anchor is CommentaryAnchor => Boolean(anchor?.quote))
  ), [sections])
  const selectedKey = candidate ? commentaryAnchorKey(candidate) : ''

  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    // Attributes and a head stylesheet do not change source text or body element indices.
    const accent = getComputedStyle(panel.current!).getPropertyValue('--reader-accent').trim() || '#936846'
    const cleanups = sections.map(({ contents, chapterHref }) => {
      const doc = contents.document
      const attribute = 'data-mdr-commentary-position'
      const originals = new Map<Element, string | null>()
      const mark = (block: Element, value: string) => {
        if (!originals.has(block)) originals.set(block, block.getAttribute(attribute))
        block.setAttribute(attribute, value)
      }
      const restore = (block: Element) => {
        const original = originals.get(block)
        if (original == null) block.removeAttribute(attribute)
        else block.setAttribute(attribute, original)
      }
      const selected = candidate?.chapterHref === chapterHref ? resolveSourceAnchor(doc, candidate) : null
      if (selected) mark(selected, 'selected')
      const style = doc.createElement('style')
      style.textContent = `
        [${attribute}] { outline: 2px dashed ${accent} !important; outline-offset: 3px !important; cursor: pointer !important; }
        [${attribute}="selected"] { outline-style: solid !important; background-color: color-mix(in srgb, ${accent} 14%, transparent) !important; }
      `
      doc.head.appendChild(style)
      let hovered: Element | null = null
      const clearHover = () => { if (hovered && hovered !== selected) restore(hovered); hovered = null }
      const move = (event: MouseEvent) => {
        const block = event.composedPath().some(node => (node as Element).localName === COMMENTARY_HOST)
          ? null : (event.target as Element).closest?.(COMMENTARY_BLOCKS) ?? null
        if (block === hovered) return
        clearHover()
        if (block && block !== selected) { mark(block, 'hover'); hovered = block }
      }
      doc.addEventListener('mousemove', move)
      doc.addEventListener('mouseleave', clearHover)
      return () => {
        doc.removeEventListener('mousemove', move)
        doc.removeEventListener('mouseleave', clearHover)
        originals.forEach((_value, block) => restore(block))
        style.remove()
      }
    })
    return () => cleanups.forEach(cleanup => cleanup())
  }, [sections, candidate])

  return <section ref={panel} className="commentary-position-picker" data-commentary-ui="true" tabIndex={-1}
    aria-label="주석을 넣을 문단 선택" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
    }}>
    <header><strong>어느 문단 뒤에 넣을까요?</strong><button onClick={onCancel}>편집기로 돌아가기 <kbd>Esc</kbd></button></header>
    <p>본문에 마우스를 올리면 문단이 강조됩니다. 원하는 문단을 클릭하세요.</p>
    <label>또는 펼쳐진 장의 문단 목록에서 선택
      <select value={selectedKey} onChange={event => {
        const anchor = paragraphs.find(item => commentaryAnchorKey(item) === event.target.value)
        if (anchor) {
          onChoose(anchor)
          void Promise.resolve().then(() => onNavigate(anchor)).catch(error => onError(String(error)))
        }
      }}>
        <option value="" disabled>문단을 선택하세요</option>
        {candidate && !paragraphs.some(item => commentaryAnchorKey(item) === selectedKey) && <option value={selectedKey}>선택한 문단: {candidate.quote.slice(0, 100)}</option>}
        {paragraphs.map((anchor, index) => <option key={commentaryAnchorKey(anchor)} value={commentaryAnchorKey(anchor)}>{index + 1}. {anchor.quote.slice(0, 120)}</option>)}
      </select>
    </label>
    <div className="commentary-position-preview" aria-live="polite" aria-atomic="true">
      <span>{candidate ? '선택한 원문' : '아직 문단을 선택하지 않았습니다.'}</span>
      {candidate && <><blockquote>{candidate.quote}</blockquote><p>↓ 이 문단이 끝난 뒤 주석이 표시됩니다.</p></>}
    </div>
    <footer><span>단어·커서 위치가 아닌 문단 끝에 넣습니다.<br />위치를 적용한 뒤 ‘주석 저장’을 눌러 완료하세요.</span><button onClick={onConfirm} disabled={!candidate}>이 문단 뒤에 넣기</button></footer>
  </section>
}
