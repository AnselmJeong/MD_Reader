import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommentarySection } from './EpubCommentary'
import { attachEpubImages, type EpubImage } from './utils/epubImages'

export function ImageDialog({ image, onClose }: { image: EpubImage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const fit = natural.width && area.width
    ? Math.min(8, Math.max(1, area.width - 48) / natural.width, Math.max(1, area.height - 48) / natural.height) : 1
  const scale = zoom ?? fit
  const resize = (factor: number) => setZoom(Math.max(Math.min(fit, .1), Math.min(8, scale * factor)))
  useEffect(() => {
    const modal = dialog.current!
    const stage = viewport.current!
    modal.showModal()
    closeButton.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage)
    return () => {
      observer.disconnect()
      modal.close()
      if (image.trigger.isConnected) (image.trigger as HTMLElement).focus({ preventScroll: true })
    }
  }, [image])
  return <dialog ref={dialog} className="epub-image-dialog" aria-label="그림 크게 보기"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); resize(1.25) }
      if (event.key === '-') { event.preventDefault(); resize(1 / 1.25) }
      if (event.key === '0') { event.preventDefault(); setZoom(null) }
    }}>
    <header>
      <strong title={image.label}>{image.label}</strong>
      <div className="epub-image-controls" role="group" aria-label="그림 배율">
        <button aria-label="축소" disabled={failed || scale <= Math.min(fit, .1)} onClick={() => resize(1 / 1.25)}>−</button>
        <output aria-label="확대 배율">{Math.round(scale * 100)}%</output>
        <button aria-label="확대" disabled={failed || scale >= 8} onClick={() => resize(1.25)}>+</button>
        <button aria-pressed={zoom === null} onClick={() => setZoom(null)}>화면에 맞춤</button>
        <button aria-pressed={zoom === 1} onClick={() => setZoom(1)}>원본 크기</button>
      </div>
      <button ref={closeButton} aria-label="그림 닫기" onClick={onClose}>닫기 <kbd>Esc</kbd></button>
    </header>
    <div ref={viewport} className="epub-image-viewport" tabIndex={0} aria-label="확대한 그림, 스크롤하여 이동"
      onPointerDown={event => {
        if (event.button !== 0 || event.pointerType !== 'mouse') return
        const stage = event.currentTarget
        drag.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }
        stage.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (!drag.current) return
        event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX
        event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY
      }}
      onPointerUp={event => {
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { drag.current = null }}>
      {failed ? <p role="alert">그림을 불러오지 못했습니다. 닫은 뒤 다시 열어 주세요.</p> :
        <div className="epub-image-canvas" style={{ width: natural.width * scale + 48, minHeight: natural.height * scale + 48 }}>
          <img src={image.src} alt={image.label} draggable={false}
            style={{ width: natural.width ? natural.width * scale : undefined, visibility: natural.width && area.width ? 'visible' : 'hidden' }}
            onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailed(true)} />
        </div>}
    </div>
    <footer>확대한 그림은 드래그하거나 스크롤하여 이동할 수 있습니다.</footer>
  </dialog>
}

export function EpubImageViewer({ sections }: { sections: CommentarySection[] }) {
  const [image, setImage] = useState<EpubImage | null>(null)
  const close = useCallback(() => setImage(null), [])
  useEffect(() => {
    const cleanups = sections.map(section => attachEpubImages(section.contents.document, setImage))
    setImage(current => current?.trigger.isConnected ? current : null)
    return () => cleanups.forEach(cleanup => cleanup())
  }, [sections])
  return image ? <ImageDialog image={image} onClose={close} /> : null
}
