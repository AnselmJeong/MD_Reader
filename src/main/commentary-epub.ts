import JSZip from 'jszip'
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { importCommentarySnapshot, listCommentary } from './commentary-service'
import { commentaryText, type CommentarySnapshot, type CommentaryNote } from '../shared/commentary'
import { renderCommentary } from '../shared/commentary-markdown'
import { renderCommentaryHtml, escapeHtml, resolveCommentaryContent } from '../shared/commentary-html'
import { coachImageStoreKey } from '../shared/coach'
import {
  COACH_ARCHIVE_FORMAT, COACH_ARCHIVE_VERSION, IMAGE_EXTENSIONS, MAX_ARCHIVE_DECKS, MAX_ARCHIVE_IMAGES, MAX_ARCHIVE_IMAGE_BYTES,
  quotePattern, sanitizeArchiveDeck, sanitizeArchiveImage, type CoachArchive, type CoachArchiveImageData
} from '../shared/coach-archive'

const PREFIX = 'MDReader-Commentary/'
const METADATA = PREFIX + 'commentary.json'
const ORIGINAL = PREFIX + 'original.epub'
const COACH = PREFIX + 'coach.json'
const COACH_IMAGES = PREFIX + 'coach-images/'
const OPS = 'http://www.idpf.org/2007/ops'
const XMLNS = 'http://www.w3.org/2000/xmlns/'
const MAX_COACH_IMAGE_TOTAL = 96 * 1024 * 1024
export type CoachImporter = (documentId: string, archive: CoachArchive) => void
const XHTML = 'http://www.w3.org/1999/xhtml'
const OPF = 'http://www.idpf.org/2007/opf'
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function entryBytes(zip: JSZip, name: string, limit = MAX_ARCHIVE_BYTES) {
  const entry = zip.file(name)
  if (!entry) throw new Error(`EPUB 리소스를 찾을 수 없습니다: ${name}`)
  // JSZip exposes the declared size on its compressed entry. Check before inflation too.
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (size && size > limit) throw new Error('EPUB 리소스의 크기 제한을 초과했습니다.')
  const bytes = await entry.async('nodebuffer')
  if (bytes.length > limit) throw new Error('EPUB 리소스의 크기 제한을 초과했습니다.')
  return bytes
}

/** Coach cards from `coach.json`; a broken coach file never blocks opening the book. */
export async function readCoachArchive(zip: JSZip, sourceHash: string): Promise<CoachArchive | null> {
  if (!zip.file(COACH)) return null
  const data = JSON.parse((await entryBytes(zip, COACH, 32 * 1024 * 1024)).toString('utf8'))
  if (data?.format !== COACH_ARCHIVE_FORMAT || data.version !== COACH_ARCHIVE_VERSION || data.sourceHash !== sourceHash) return null
  const decks = (Array.isArray(data.decks) ? data.decks.slice(0, MAX_ARCHIVE_DECKS) : []).map((deck: unknown) => sanitizeArchiveDeck(deck, sourceHash)).filter(Boolean)
  const images: CoachArchiveImageData[] = []
  let total = 0
  for (const entry of Array.isArray(data.images) ? data.images.slice(0, MAX_ARCHIVE_IMAGES) : []) {
    const image = sanitizeArchiveImage(entry)
    const file = typeof entry?.file === 'string' ? entry.file : ''
    if (!image || !/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(file) || !zip.file(COACH_IMAGES + file)) continue
    const bytes = await entryBytes(zip, COACH_IMAGES + file, MAX_ARCHIVE_IMAGE_BYTES).catch(() => null)
    if (!bytes || hash(bytes) !== file.split('.')[0]) continue
    total += bytes.length
    if (total > MAX_COACH_IMAGE_TOTAL) break
    images.push({ ...image, bytes })
  }
  return { bookTitle: typeof data.bookTitle === 'string' ? data.bookTitle.slice(0, 300) : '', decks, images }
}

export async function readCommentaryEpub(buffer: Buffer, importNotes = true, importCoach?: CoachImporter): Promise<Buffer> {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('EPUB 크기가 256 MB를 넘습니다.')
  const zip = await JSZip.loadAsync(buffer)
  if (!zip.file(METADATA)) return buffer
  const metadata = JSON.parse((await entryBytes(zip, METADATA, 32 * 1024 * 1024)).toString('utf8'))
  if (metadata.format !== 'md-reader-commentary' || metadata.version !== 1) throw new Error('지원하지 않는 주석 EPUB 형식입니다.')
  const original = await entryBytes(zip, ORIGINAL)
  if (hash(original) !== metadata.sourceHash) throw new Error('보존된 원본 EPUB 검증에 실패했습니다.')
  if (!Array.isArray(metadata.assets) || metadata.assets.length > 1000) throw new Error('첨부 목록이 올바르지 않습니다.')
  const assets = []
  let total = 0
  for (const asset of metadata.assets) {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.id)) throw new Error('첨부 식별자가 올바르지 않습니다.')
    const bytes = await entryBytes(zip, `${PREFIX}images/${asset.id}.png`, 8 * 1024 * 1024)
    total += bytes.length
    if (total > 128 * 1024 * 1024) throw new Error('전체 첨부 크기 제한을 초과했습니다.')
    assets.push({ id: asset.id, name: asset.name, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` })
  }
  if (importNotes) importCommentarySnapshot(metadata.sourceHash, { notes: metadata.notes, assets })
  if (importNotes && importCoach) {
    try {
      const coach = await readCoachArchive(zip, metadata.sourceHash)
      if (coach) importCoach(metadata.sourceHash, coach)
    } catch (error) { console.error('[Commentary] Coach cards in this EPUB could not be imported:', error) }
  }
  return original
}

function xml(text: string) {
  return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(`EPUB XML: ${message}`) } })
    .parseFromString(text, 'application/xhtml+xml')
}

function elements(element: XmlElement): XmlElement[] {
  return Array.from(element.childNodes).filter(node => node.nodeType === 1) as XmlElement[]
}

function resolvePath(base: string, href: string) {
  const decoded = decodeURIComponent(href.split('#')[0])
  const result = path.posix.normalize(path.posix.join(base, decoded))
  if (result.startsWith('../') || path.posix.isAbsolute(result)) throw new Error('EPUB 내부 경로가 올바르지 않습니다.')
  return result
}

function noteHtml(note: CommentaryNote, snapshot: CommentarySnapshot, assetUrls: Record<string, string>, htmlUrls: Record<string, string>): string {
  const children = snapshot.notes.filter(item => item.parentId === note.id)
  const body = note.deletedAt ? '<p class="mdr-deleted">삭제된 주석</p>' : renderCommentary(note.markdown, assetUrls, true)
  const origin = !note.deletedAt && note.origin ? '<p class="mdr-origin">AI 대화에서 가져온 주석</p>' : ''
  const attachment = !note.deletedAt && note.html ? `<p><a href="${escapeHtml(htmlUrls[note.id])}">HTML 주석 열기: ${escapeHtml(note.html.name)}</a></p>` : ''
  return `<aside xmlns="${XHTML}" class="mdr-commentary" id="mdr-${note.id}"><p class="mdr-label">주석</p>${origin}${body}${attachment}${children.map(child => noteHtml(child, snapshot, assetUrls, htmlUrls)).join('')}</aside>`
}

const hasClass = (node: Node | null, name: string) => node?.nodeType === 1 && ((node as unknown as XmlElement).getAttribute('class') ?? '').split(/\s+/).includes(name)
const BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'dd', 'dt', 'figcaption', 'caption', 'pre', 'div', 'section'])

/** Inside our own additions (commentary blocks, coach notes and links), nothing is matched again. */
function insideOurs(node: Node) {
  for (let cursor: Node | null = node; cursor; cursor = cursor.parentNode) {
    if (hasClass(cursor, 'mdr-commentary') || hasClass(cursor, 'mdr-coach-note') || hasClass(cursor, 'mdr-coach-ref')) return true
  }
  return false
}

/**
 * Link a card's quote to its EPUB 3 footnote. The quote itself becomes the link when it sits in one text node;
 * otherwise a small marker follows the paragraph that holds it. Returns false when the quote is not in the chapter.
 */
function linkCoachQuote(doc: ReturnType<typeof xml>, body: XmlElement, quote: string, noteId: string): boolean {
  const pattern = quotePattern(quote)
  if (!pattern) return false
  const link = () => {
    const a = doc.createElementNS(XHTML, 'a')
    a.setAttributeNS(OPS, 'epub:type', 'noteref')
    a.setAttribute('class', 'mdr-coach-ref')
    a.setAttribute('href', `#${noteId}`)
    a.setAttribute('id', `${noteId}-ref`)
    return a
  }
  const texts: Node[] = []
  const walk = (node: Node) => { for (const child of Array.from(node.childNodes)) { if (child.nodeType === 3) texts.push(child); else if (child.nodeType === 1 && !insideOurs(child)) walk(child) } }
  walk(body as unknown as Node)
  for (const text of texts) {
    const value = text.nodeValue ?? ''
    const match = pattern.exec(value)
    if (!match || text.parentNode?.nodeType !== 1 || (text.parentNode as unknown as XmlElement).localName === 'a') continue
    const a = link()
    a.appendChild(doc.createTextNode(match[0]))
    const parent = text.parentNode
    // xmldom serializes a text node's `data`, so the node is replaced rather than edited.
    parent.insertBefore(doc.createTextNode(value.slice(0, match.index)) as unknown as Node, text)
    parent.insertBefore(a as unknown as Node, text)
    parent.insertBefore(doc.createTextNode(value.slice(match.index + match[0].length)) as unknown as Node, text)
    parent.removeChild(text)
    return true
  }
  const wanted = commentaryText(quote.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—]/g, '-'))
  const normal = (text: string) => commentaryText(text.replace(/­/g, '').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—]/g, '-'))
  const blocks = Array.from(body.getElementsByTagName('*')).filter(element => BLOCKS.has(element.localName ?? '') && !insideOurs(element as unknown as Node)
    && normal(element.textContent ?? '').includes(wanted))
  // The innermost block that holds the whole quote.
  const block = blocks.find(element => !Array.from(element.getElementsByTagName('*')).some(child => blocks.includes(child)))
  if (!block) return false
  const sup = doc.createElementNS(XHTML, 'sup')
  const a = link()
  a.appendChild(doc.createTextNode('*'))
  sup.appendChild(a)
  block.appendChild(sup)
  return true
}

function coachNoteHtml(id: string, card: CoachArchive['decks'][number]['cards'][number], image: { href: string; data: CoachArchiveImageData } | undefined) {
  const picture = image
    ? `<p class="mdr-coach-picture"><img src="${escapeHtml(image.href)}" alt="${escapeHtml(card.title)}"/></p>`
      + (image.data.pageUrl ? `<p class="mdr-coach-source">그림: <a href="${escapeHtml(image.data.pageUrl)}">${escapeHtml(image.data.source ?? 'Wikipedia')} — ${escapeHtml(image.data.pageTitle ?? card.title)}</a></p>` : '')
    : ''
  return `<aside xmlns="${XHTML}" xmlns:epub="${OPS}" epub:type="footnote" class="mdr-coach-note" id="${id}"><p><strong>${escapeHtml(card.title)}</strong> ${escapeHtml(card.gloss)}</p>${picture}<p class="mdr-coach-label">AI 코치 카드</p></aside>`
}

export async function compileCommentaryEpub(original: Buffer, snapshot: CommentarySnapshot, coach?: CoachArchive): Promise<Buffer> {
  snapshot = { ...snapshot, notes: snapshot.notes.map(note => ({ ...note, ...resolveCommentaryContent(note) })) }
  if (snapshot.notes.length > 10000 || snapshot.assets.length > 1000) throw new Error('이동용 EPUB의 주석 또는 첨부 개수 제한을 초과했습니다.')
  const metadataJson = JSON.stringify({ format: 'md-reader-commentary', version: 1, sourceHash: hash(original), notes: snapshot.notes, assets: snapshot.assets.map(({ id, name }) => ({ id, name })) })
  if (Buffer.byteLength(metadataJson) > 32 * 1024 * 1024) throw new Error('이동용 EPUB의 주석 데이터가 32 MB를 초과했습니다.')
  const assetBytes = snapshot.assets.map(asset => Buffer.from(asset.dataUrl.slice(22), 'base64'))
  if (assetBytes.some(bytes => bytes.length > 8 * 1024 * 1024) || assetBytes.reduce((sum, bytes) => sum + bytes.length, 0) > 128 * 1024 * 1024) throw new Error('이동용 EPUB의 첨부 크기 제한을 초과했습니다.')
  const input = await JSZip.loadAsync(original)
  if (input.file(METADATA) || Object.keys(input.files).some(name => name.startsWith(PREFIX))) throw new Error('원본 EPUB에 예약된 주석 경로가 이미 있습니다.')
  const container = xml((await entryBytes(input, 'META-INF/container.xml')).toString('utf8'))
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB 패키지 경로를 찾을 수 없습니다.')
  const packageDoc = xml((await entryBytes(input, opfPath)).toString('utf8'))
  const manifest = packageDoc.getElementsByTagName('manifest')[0]
  if (!manifest) throw new Error('EPUB manifest가 없습니다.')
  const version = packageDoc.documentElement?.getAttribute('version') ?? ''
  if (!version.startsWith('2') && !version.startsWith('3')) throw new Error('지원하지 않는 EPUB 버전입니다.')
  // The derivative uses EPUB 3, while its embedded original stays byte-identical.
  packageDoc.documentElement!.setAttribute('version', '3.0')
  const output = new JSZip()
  output.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  let expandedBytes = 0
  for (const [name, file] of Object.entries(input.files)) {
    if (file.dir || name === 'mimetype') continue
    const bytes = await entryBytes(input, name)
    expandedBytes += bytes.length
    if (expandedBytes > 512 * 1024 * 1024) throw new Error('압축 해제된 EPUB이 너무 큽니다.')
    output.file(name, bytes)
  }
  const opfDir = path.posix.dirname(opfPath)
  const resourcePaths = new Set(Array.from(manifest.getElementsByTagName('item')).map(item => resolvePath(opfDir, item.getAttribute('href') ?? '')))
  const modified = new Map<string, ReturnType<typeof xml>>()
  const chapterDoc = async (chapterPath: string) => {
    let doc = modified.get(chapterPath)
    if (!doc) { doc = xml((await entryBytes(input, chapterPath)).toString('utf8')); modified.set(chapterPath, doc) }
    return doc
  }
  for (const note of snapshot.notes.filter(item => !item.parentId)) {
    const chapterPath = resolvePath(opfDir, note.anchor.chapterHref)
    if (!resourcePaths.has(chapterPath)) throw new Error(`주석의 장을 찾을 수 없습니다: ${note.anchor.chapterHref}`)
    const doc = await chapterDoc(chapterPath)
    // Resolve against pristine source, since inserted siblings change positional paths.
    const pristine = xml((await entryBytes(input, chapterPath)).toString('utf8'))
    let target = pristine.getElementsByTagName('body')[0] as XmlElement | undefined
    for (const index of note.anchor.path) target = target && elements(target)[index]
    const matches = (element: XmlElement | undefined) => element && (!note.anchor.tagName || element.localName === note.anchor.tagName)
      && commentaryText(element.textContent ?? '').slice(0, 10000) === note.anchor.quote
    if (!matches(target)) {
      const candidates = Array.from(pristine.getElementsByTagName(note.anchor.tagName || '*')).filter(element => matches(element))
      const identified = candidates.find(element => note.anchor.elementId && element.getAttribute('id') === note.anchor.elementId)
      target = identified ?? (candidates.length === 1 ? candidates[0] : undefined)
    }
    if (!target) {
      throw new Error('위치를 찾을 수 없는 주석이 있습니다. 주석 목록에서 위치를 다시 지정해 주세요.')
    }
    const resolvedPath: number[] = []
    for (let cursor = target; cursor.localName !== 'body'; cursor = cursor.parentNode as XmlElement) {
      if (!cursor.parentNode || cursor.parentNode.nodeType !== 1) throw new Error('원문 본문 안의 주석 위치를 찾을 수 없습니다.')
      resolvedPath.unshift(elements(cursor.parentNode as XmlElement).indexOf(cursor))
    }
    // Follow the same path ignoring only our exported nodes.
    let live = doc.getElementsByTagName('body')[0]
    for (const index of resolvedPath) live = elements(live).filter(el => !el.getAttribute('class')?.split(' ').includes('mdr-commentary'))[index]
    const urls = Object.fromEntries(snapshot.assets.map(asset => [asset.id, path.posix.relative(path.posix.dirname(chapterPath), `${PREFIX}images/${asset.id}.png`)]))
    const htmlUrls = Object.fromEntries(snapshot.notes.filter(item => item.html).map(item => [item.id, path.posix.relative(path.posix.dirname(chapterPath), `${PREFIX}html/${item.id}.xhtml`)]))
    const parsed = xml(noteHtml(note, snapshot, urls, htmlUrls))
    const aside = doc.importNode(parsed.documentElement!, true)
    if (['body', 'li', 'td', 'th'].includes(live.localName ?? '')) live.appendChild(aside)
    else {
      let next = live.nextSibling
      while (next?.nodeType === 1 && (next as XmlElement).getAttribute('class')?.split(' ').includes('mdr-commentary')) next = next.nextSibling
      live.parentNode!.insertBefore(aside, next)
    }
  }
  // Coach cards: EPUB 3 footnotes (popups in Apple Books and others) plus coach.json for MD Reader.
  const coachDecks = (coach?.decks ?? []).slice(0, MAX_ARCHIVE_DECKS)
  const coachImages = new Map<string, { file: string; data: CoachArchiveImageData }>()
  let coachImageBytes = 0
  for (const image of (coach?.images ?? []).slice(0, MAX_ARCHIVE_IMAGES)) {
    if (image.bytes.length > MAX_ARCHIVE_IMAGE_BYTES || coachImageBytes + image.bytes.length > MAX_COACH_IMAGE_TOTAL) continue
    coachImageBytes += image.bytes.length
    coachImages.set(image.key, { file: `${hash(Buffer.from(image.bytes))}.${IMAGE_EXTENSIONS[image.mime]}`, data: image })
  }
  // Cards already put in the book as commentary ("EPUB에 넣기") are not repeated as footnotes.
  const inserted = new Set(snapshot.notes.filter(note => !note.deletedAt && note.origin?.messageId?.startsWith('coach:')).map(note => note.origin!.messageId.slice(6)))
  const styledChapters = new Set<string>()
  const footnotes = new Map<string, Set<string>>()
  for (const deck of coachDecks) {
    let chapterPath: string
    try { chapterPath = resolvePath(opfDir, deck.chapterHref) } catch { continue }
    if (!resourcePaths.has(chapterPath) || !/\.x?html?$/i.test(chapterPath)) continue
    const doc = await chapterDoc(chapterPath)
    const body = doc.getElementsByTagName('body')[0]
    if (!body) continue
    const done = footnotes.get(chapterPath) ?? new Set<string>()
    footnotes.set(chapterPath, done)
    for (const card of deck.cards) {
      const id = `mdr-coach-${card.id}`
      if (inserted.has(card.id) || done.has(id) || doc.getElementById?.(id)) continue
      if (!linkCoachQuote(doc, body, card.quote, id)) continue
      done.add(id)
      const image = coachImages.get(coachImageStoreKey(card))
      const note = xml(coachNoteHtml(id, card, image && { href: path.posix.relative(path.posix.dirname(chapterPath), COACH_IMAGES + image.file), data: image.data }))
      body.appendChild(doc.importNode(note.documentElement!, true))
      styledChapters.add(chapterPath)
    }
  }
  const serializer = new XMLSerializer()
  for (const [name, doc] of modified) {
    if (styledChapters.has(name) && !doc.documentElement!.getAttribute('xmlns:epub')) doc.documentElement!.setAttributeNS(XMLNS, 'xmlns:epub', OPS)
    const link = doc.createElementNS(XHTML, 'link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('type', 'text/css')
    link.setAttribute('href', path.posix.relative(path.posix.dirname(name), `${PREFIX}commentary.css`))
    doc.getElementsByTagName('head')[0].appendChild(link)
    output.file(name, serializer.serializeToString(doc))
    // Native MathML is portable and avoids shipping runtime font/JS dependencies.
    if (doc.getElementsByTagName('math').length) {
      const item = Array.from(manifest.getElementsByTagName('item')).find(item => resolvePath(opfDir, item.getAttribute('href') ?? '') === name)!
      item.setAttribute('properties', [...new Set(`${item.getAttribute('properties') ?? ''} mathml`.trim().split(/\s+/))].join(' '))
    }
  }
  const add = (name: string, type: string, data: string | Buffer) => {
    output.file(name, data)
    const item = packageDoc.createElementNS(OPF, 'item')
    item.setAttribute('id', `mdr-${randomUUID()}`)
    item.setAttribute('href', path.posix.relative(opfDir, name))
    item.setAttribute('media-type', type)
    manifest.appendChild(item)
    return item
  }
  if (!Array.from(manifest.getElementsByTagName('item')).some(item => item.getAttribute('properties')?.split(/\s+/).includes('nav'))) {
    const navDoc = xml(`<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol/></nav></body></html>`)
    const ol = navDoc.getElementsByTagName('ol')[0]
    for (const [index, ref] of Array.from(packageDoc.getElementsByTagName('itemref')).entries()) {
      const item = Array.from(manifest.getElementsByTagName('item')).find(item => item.getAttribute('id') === ref.getAttribute('idref'))
      if (!item) continue
      const chapterPath = resolvePath(opfDir, item.getAttribute('href') ?? '')
      const chapter = xml((await entryBytes(input, chapterPath)).toString('utf8'))
      const title = chapter.getElementsByTagName('h1')[0]?.textContent || chapter.getElementsByTagName('title')[0]?.textContent || `Section ${index + 1}`
      const li = navDoc.createElementNS(XHTML, 'li'), a = navDoc.createElementNS(XHTML, 'a')
      a.setAttribute('href', path.posix.relative(PREFIX, chapterPath)); a.textContent = title
      li.appendChild(a); ol.appendChild(li)
    }
    add(`${PREFIX}nav.xhtml`, 'application/xhtml+xml', serializer.serializeToString(navDoc)).setAttribute('properties', 'nav')
  }
  add(ORIGINAL, 'application/epub+zip', original)
  add(METADATA, 'application/json', metadataJson)
  if (coachDecks.length) {
    add(COACH, 'application/json', JSON.stringify({
      format: COACH_ARCHIVE_FORMAT, version: COACH_ARCHIVE_VERSION, sourceHash: hash(original), bookTitle: coach?.bookTitle ?? '', decks: coachDecks,
      images: [...coachImages.values()].map(({ file, data: { key, mime, pageTitle, pageUrl, source } }) => ({ key, mime, pageTitle, pageUrl, source, file }))
    }))
    const written = new Set<string>()
    for (const { file, data } of coachImages.values()) {
      if (written.has(file)) continue
      written.add(file)
      add(COACH_IMAGES + file, data.mime, Buffer.from(data.bytes))
    }
  }
  add(`${PREFIX}commentary.css`, 'text/css', `.mdr-coach-ref{color:inherit;text-decoration:underline dotted #927655}.mdr-coach-note{display:block;margin:1em 0;padding:.6em .9em;border-left:2px solid #6f8aa3;background:#f3f6f9;color:#2a3138;font-size:.88em;line-height:1.6}.mdr-coach-note img{max-width:100%;height:auto}.mdr-coach-label,.mdr-coach-source{font:small sans-serif;color:#5b6772}.mdr-commentary{display:block;margin:1.2em 0;padding:.8em 1em;border-left:2px solid #927655;background:#f8f5ef;color:#302b25;font-size:.92em;line-height:1.65}.mdr-commentary .mdr-commentary{margin-left:.75em}.mdr-label,.mdr-origin{font:small sans-serif;color:#66594c}.mdr-commentary img{max-width:100%;height:auto}.mdr-commentary table{border-collapse:collapse;border-top:2px solid;border-bottom:2px solid}.mdr-commentary th,.mdr-commentary td{padding:.5em;vertical-align:top}.mdr-commentary th{border-bottom:1px solid}.mdr-deleted{font-style:italic}`)
  for (const [index, asset] of snapshot.assets.entries()) add(`${PREFIX}images/${asset.id}.png`, 'image/png', assetBytes[index])
  for (const note of snapshot.notes) if (note.html && !note.deletedAt) {
    const html = renderCommentaryHtml(note.html)
    const item = add(`${PREFIX}html/${note.id}.xhtml`, 'application/xhtml+xml', html)
    const properties = [/<svg[\s>]/.test(html) ? 'svg' : '', /<math[\s>]/.test(html) ? 'mathml' : ''].filter(Boolean)
    if (properties.length) item.setAttribute('properties', properties.join(' '))
    const ref = packageDoc.createElementNS(OPF, 'itemref')
    ref.setAttribute('idref', item.getAttribute('id')!)
    ref.setAttribute('linear', 'no')
    packageDoc.getElementsByTagName('spine')[0].appendChild(ref)
  }
  let modifiedMeta = Array.from(packageDoc.getElementsByTagName('meta')).find(meta => meta.getAttribute('property') === 'dcterms:modified')
  if (!modifiedMeta) {
    modifiedMeta = packageDoc.createElementNS(OPF, 'meta')
    modifiedMeta.setAttribute('property', 'dcterms:modified')
    packageDoc.getElementsByTagName('metadata')[0].appendChild(modifiedMeta)
  }
  modifiedMeta.textContent = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  output.file(opfPath, serializer.serializeToString(packageDoc))
  const bytes = await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('주석 포함 EPUB이 256 MB를 넘습니다. 첨부 크기를 줄여 주세요.')
  return bytes
}

export async function exportCommentaryEpub(sourcePath: string, destination: string, documentId: string, coach?: CoachArchive) {
  const sourceRealPath = await fs.realpath(sourcePath)
  const destinationRealPath = await fs.realpath(destination).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  const sourceBytes = await fs.readFile(sourceRealPath)
  const original = await readCommentaryEpub(sourceBytes, false)
  // A suffix alone does not grant overwrite permission. Only a validated
  // commentary archive, with its hash-checked embedded original, is editable.
  const sameFile = destinationRealPath === sourceRealPath
  if (sameFile && original === sourceBytes) throw new Error('원문 보존을 위해 다른 파일 이름으로 저장해 주세요.')
  if (hash(original) !== documentId) throw new Error('원본 파일이 변경되었습니다. 문서를 다시 열어 주세요.')
  const bytes = await compileCommentaryEpub(original, listCommentary(documentId), coach)
  // Replacing a symlink itself would leave the loaded target stale; replace the
  // resolved archive instead when resaving through an alias.
  const target = sameFile ? sourceRealPath : destination
  const temporary = path.join(path.dirname(target), `.md-reader-${randomUUID()}.tmp`)
  try {
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    if (sameFile && !sourceBytes.equals(await fs.readFile(sourceRealPath))) throw new Error('저장하는 동안 EPUB 파일이 변경되었습니다. 다시 열어 확인해 주세요.')
    await fs.rename(temporary, target)
  } finally { await fs.rm(temporary, { force: true }) }
}

export function commentaryExportPath(filePath: string): string {
  const stem = path.basename(filePath, path.extname(filePath)).replace(/(?:-annotated)+$/i, '')
  return path.join(path.dirname(filePath), `${stem}-annotated.epub`)
}
