import type { Book, Contents } from 'epubjs'

export interface EpubLinkPreview {
  title: string
  url: string | null
  rect: DOMRect
}

function webUrl(href: string): string | null {
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}

const text = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim() || ''

// Resolve archive-local reference targets without navigating away from the page.
export async function resolveEpubLink(
  anchor: Element, contents: Contents, book: Book, documents: Map<string, Promise<Document>>
): Promise<{ title: string; url: string | null } | null> {
  const href = anchor.getAttribute('href') || ''
  const external = webUrl(href)
  if (external) return { title: anchor.getAttribute('title') || text(anchor) || external, url: external }
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return null

  const section = book.spine.get(contents.sectionIndex)
  if (!section) return null
  const base = new URL(section.url, 'https://epub.invalid/')
  const target = new URL(href, base)
  if (target.origin !== base.origin || !target.hash) return null
  let doc = contents.document
  if (target.pathname !== base.pathname) {
    let pending = documents.get(target.pathname)
    if (!pending) {
      pending = book.load(target.pathname) as Promise<Document>
      documents.set(target.pathname, pending)
      pending.catch(() => documents.delete(target.pathname))
    }
    doc = await pending
  }
  const reference = doc.getElementById(decodeURIComponent(target.hash.slice(1)))
  if (!reference) return null
  const links = Array.from(reference.querySelectorAll('a[href]'))
  if (reference.matches('a[href]')) links.unshift(reference as HTMLAnchorElement)
  const linkedTitle = links.find((link) => webUrl(link.getAttribute('href') || ''))
  if (linkedTitle) return {
    title: linkedTitle.getAttribute('title') || text(linkedTitle) || text(reference),
    url: webUrl(linkedTitle.getAttribute('href') || '')
  }
  const clone = reference.cloneNode(true) as Element
  clone.querySelectorAll('a[role="doc-backlink"], a.footnote-back, a[epub\\:type="backlink"]').forEach((link) => link.remove())
  return { title: anchor.getAttribute('title') || text(clone), url: null }
}

export function createEpubLinkTooltips(options: {
  book: Book
  viewer: HTMLElement
  tooltipContains: (target: Node) => boolean
  onChange: (preview: EpubLinkPreview | null) => void
}) {
  const { book, viewer, tooltipContains, onChange } = options
  const documents = new Map<string, Promise<Document>>()
  const cleanups = new Set<() => void>()
  let active: Element | null = null
  let revision = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelHide = () => { clearTimeout(timer); timer = undefined }
  const hide = () => { cancelHide(); active = null; revision += 1; onChange(null) }
  const scheduleHide = () => { if (!timer) timer = setTimeout(hide, 250) }
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
  const outside = (event: Event) => {
    const target = event.target as Node | null
    if (target && tooltipContains(target)) cancelHide()
    else scheduleHide()
  }
  const blur = () => {
    // Focusing an EPUB iframe must not dismiss its keyboard preview.
    if (!viewer.contains(document.activeElement)) hide()
  }
  document.addEventListener('pointerover', outside)
  document.addEventListener('focusin', outside)
  document.addEventListener('keydown', keydown)
  window.addEventListener('resize', hide)
  window.addEventListener('blur', blur)
  viewer.addEventListener('scroll', hide, true)

  const attach = (contents: Contents) => {
    const doc = contents.document
    const handleTarget = (target: EventTarget | null) => {
      // iframe elements belong to another JS realm: do not use instanceof Element.
      const element = target as Element | null
      const anchor = typeof element?.closest === 'function' ? element.closest('a[href]') : null
      if (!anchor) { scheduleHide(); return }
      cancelHide()
      if (active === anchor) return
      active = anchor
      const request = ++revision
      onChange(null)
      void resolveEpubLink(anchor, contents, book, documents).then((preview) => {
        if (disposed || request !== revision || !anchor.isConnected || !preview?.title) return
        const frame = contents.window.frameElement
        if (!frame) return
        const origin = frame.getBoundingClientRect()
        const rect = anchor.getBoundingClientRect()
        onChange({ ...preview, rect: new DOMRect(origin.left + rect.left, origin.top + rect.top, rect.width, rect.height) })
      }).catch(() => { if (!disposed && request === revision) onChange(null) })
    }
    const pointer = (event: Event) => handleTarget(event.target)
    const focusout = (event: FocusEvent) => {
      if (event.relatedTarget) handleTarget(event.relatedTarget)
      else scheduleHide()
    }
    const click = (event: MouseEvent) => {
      const element = event.target as Element | null
      const anchor = typeof element?.closest === 'function' ? element.closest('a[href]') : null
      const url = anchor && webUrl(anchor.getAttribute('href') || '')
      if (!url) return // Preserve EPUB.js navigation for internal links.
      event.preventDefault()
      event.stopPropagation()
      void window.api.shell.openExternal(url).catch((error) => console.error('Failed to open EPUB link:', error))
    }
    doc.addEventListener('pointerover', pointer)
    doc.addEventListener('focusin', pointer)
    doc.addEventListener('focusout', focusout)
    doc.addEventListener('keydown', keydown)
    doc.addEventListener('click', click, true)
    doc.addEventListener('scroll', hide, true)
    doc.documentElement.addEventListener('pointerleave', scheduleHide)
    const cleanup = () => {
      if (active?.ownerDocument === doc) hide()
      doc.removeEventListener('pointerover', pointer)
      doc.removeEventListener('focusin', pointer)
      doc.removeEventListener('focusout', focusout)
      doc.removeEventListener('keydown', keydown)
      doc.removeEventListener('click', click, true)
      doc.removeEventListener('scroll', hide, true)
      doc.documentElement.removeEventListener('pointerleave', scheduleHide)
      contents.window.removeEventListener('unload', cleanup)
      cleanups.delete(cleanup)
    }
    contents.window.addEventListener('unload', cleanup)
    cleanups.add(cleanup)
  }
  return {
    attach,
    hide,
    dispose() {
      disposed = true
      hide()
      cleanups.forEach((cleanup) => cleanup())
      documents.clear()
      document.removeEventListener('pointerover', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', blur)
      viewer.removeEventListener('scroll', hide, true)
    }
  }
}
