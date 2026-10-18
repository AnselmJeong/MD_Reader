export interface EpubImage {
  src: string
  label: string
  trigger: Element
}

function imageSource(element: Element): string | null {
  const image = element.localName === 'img' ? element as HTMLImageElement : element.querySelector('image')
  const href = image?.localName === 'img'
    ? (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src
    : image?.getAttribute('href') || image?.getAttribute('xlink:href')
  if (!href) return null
  try {
    const url = new URL(href, element.ownerDocument.baseURI)
    return ['blob:', 'data:', 'file:', 'https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

// Keep source nodes in place: adding wrappers would change saved EPUB CFI paths.
export function attachEpubImages(doc: Document, open: (image: EpubImage) => void) {
  const images = new Map<Element, string>()
  const restore: (() => void)[] = []
  doc.querySelectorAll('img, svg').forEach(element => {
    if (element.closest('button, [contenteditable="true"], math, .katex')) return
    const src = imageSource(element)
    if (!src) return
    const link = element.closest('a[href]')
    // Linked figures can zoom; chapter links and external article links still navigate.
    if (link && !/\.(?:png|jpe?g|gif|webp|avif|svg|bmp)(?:[?#]|$)/i.test(link.getAttribute('href') || '')
      && link.getAttribute('href') !== src) return
    const caption = element.closest('figure')?.querySelector('figcaption')?.textContent
    const label = (caption || element.getAttribute('alt') || element.querySelector('title')?.textContent || '그림')
      .replace(/\s+/g, ' ').trim()
    images.set(element, label)
    const attributes = { tabindex: '0', role: 'button', 'aria-haspopup': 'dialog',
      'aria-label': `${label} — 크게 보기`, title: '클릭하여 그림 크게 보기' }
    for (const [name, value] of Object.entries(attributes)) {
      const previous = element.getAttribute(name)
      element.setAttribute(name, value)
      restore.push(() => previous === null ? element.removeAttribute(name) : element.setAttribute(name, previous))
    }
    const styled = element as HTMLElement | SVGElement
    const cursor = styled.style.getPropertyValue('cursor')
    const priority = styled.style.getPropertyPriority('cursor')
    styled.style.setProperty('cursor', 'zoom-in', 'important')
    restore.push(() => cursor ? styled.style.setProperty('cursor', cursor, priority) : styled.style.removeProperty('cursor'))
  })
  const activate = (event: MouseEvent | KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.type === 'click' && (event as MouseEvent).button !== 0) return
    if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return
    // EPUB iframe elements belong to a different JavaScript realm.
    const target = event.target as Element | null
    const element = target?.closest?.('img, svg')
    if (!element || !images.has(element)) return
    const src = imageSource(element)
    if (!src) return
    event.preventDefault()
    event.stopImmediatePropagation()
    open({ src, label: images.get(element)!, trigger: element })
  }
  doc.addEventListener('click', activate, true)
  doc.addEventListener('keydown', activate, true)
  return () => {
    doc.removeEventListener('click', activate, true)
    doc.removeEventListener('keydown', activate, true)
    restore.forEach(reset => reset())
  }
}
