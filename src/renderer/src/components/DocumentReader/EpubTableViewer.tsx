import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommentarySection } from './EpubCommentary'

function tableDocument(table: HTMLTableElement) {
  const source = table.ownerDocument
  const doc = document.implementation.createHTMLDocument('표 크게 보기')
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline' blob: data:; script-src 'none'; form-action 'none'; base-uri 'none'"
  doc.head.appendChild(policy)
  // Preserve book typography and embedded math, without enabling book scripts.
  source.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(element => {
    const clone = doc.importNode(element, true)
    if (element.localName === 'link') (clone as HTMLLinkElement).href = (element as HTMLLinkElement).href
    doc.head.appendChild(clone)
  })
  const clone = doc.importNode(table, true)
  clone.querySelectorAll('script, iframe, object, embed, form, md-reader-notes').forEach(element => element.remove())
  clone.querySelectorAll('*').forEach(element => {
    for (const attr of Array.from(element.attributes)) if (/^on/i.test(attr.name)) element.removeAttribute(attr.name)
    if (element.localName === 'a') element.removeAttribute('href')
  })
  doc.body.appendChild(clone)
  const computed = source.defaultView!.getComputedStyle(source.body)
  const style = doc.createElement('style')
  style.textContent = `html,body{margin:0!important;padding:24px!important;width:auto!important;height:auto!important;max-width:none!important;columns:auto!important;overflow:auto!important;background:${computed.backgroundColor}!important;color:${computed.color}!important}body{font-size:${computed.fontSize}!important;line-height:1.6!important}table{display:table!important;width:100%!important;min-width:0!important;max-width:none!important;max-height:none!important;table-layout:auto!important;overflow:visible!important;border-collapse:collapse!important;border-top:2px solid currentColor!important;border-bottom:2px solid currentColor!important}th,td{min-width:8em!important;max-width:28em!important;padding:.7em 1em!important;vertical-align:top!important;word-break:normal!important;overflow-wrap:normal!important}thead>tr:last-child>* ,tr:first-child>th{border-bottom:1px solid currentColor!important}caption{text-align:start!important;white-space:normal!important;margin-bottom:1em!important}img,svg{max-width:100%!important;max-height:none!important;object-fit:contain}td p,th p{margin:.25em 0!important}`
  doc.head.appendChild(style)
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML
}

export function EpubTableViewer({ sections }: { sections: CommentarySection[] }) {
  const [selected, setSelected] = useState<HTMLTableElement | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const tables = useMemo(() => sections.flatMap(section => Array.from(section.contents.document.querySelectorAll('table'))), [sections])
  const html = useMemo(() => selected ? tableDocument(selected) : '', [selected])
  useEffect(() => { if (selected) dialog.current?.showModal(); else dialog.current?.close() }, [selected])
  useEffect(() => { setSelected(null) }, [sections])
  if (!tables.length) return null
  return <>
    <button className="epub-table-expand" data-commentary-ui="true" onClick={() => setSelected(tables.find(table => {
      const frame = table.ownerDocument.defaultView?.frameElement
      if (!frame) return false
      const rect = table.getBoundingClientRect()
      return rect.right > 0 && rect.left < frame.clientWidth
    }) ?? tables[0])}>표 크게 보기 ↗</button>
    <dialog ref={dialog} className="epub-table-dialog" data-commentary-ui="true" onCancel={event => { event.preventDefault(); setSelected(null) }}>
      <header><strong>표 크게 보기</strong>
        {tables.length > 1 && <select aria-label="표 선택" value={tables.indexOf(selected!)} onChange={event => setSelected(tables[Number(event.target.value)])}>
          {tables.map((table, index) => <option key={index} value={index}>{table.caption?.textContent || `표 ${index + 1}`}</option>)}
        </select>}
        <button onClick={() => setSelected(null)}>닫기</button>
      </header>
      <iframe title="확대한 표" sandbox="allow-same-origin" srcDoc={html} />
    </dialog>
  </>
}
