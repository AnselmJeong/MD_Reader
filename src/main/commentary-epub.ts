import JSZip from 'jszip'
import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { importCommentarySnapshot, listCommentary } from './commentary-service'
import { commentaryText, type CommentarySnapshot, type CommentaryNote } from '../shared/commentary'
import { renderCommentary } from '../shared/commentary-markdown'
import { renderCommentaryHtml, escapeHtml, resolveCommentaryContent } from '../shared/commentary-html'

const PREFIX = 'MDReader-Commentary/'
const METADATA = PREFIX + 'commentary.json'
const ORIGINAL = PREFIX + 'original.epub'
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

export async function readCommentaryEpub(buffer: Buffer, importNotes = true): Promise<Buffer> {
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

export async function compileCommentaryEpub(original: Buffer, snapshot: CommentarySnapshot): Promise<Buffer> {
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
  for (const note of snapshot.notes.filter(item => !item.parentId)) {
    const chapterPath = resolvePath(opfDir, note.anchor.chapterHref)
    if (!resourcePaths.has(chapterPath)) throw new Error(`주석의 장을 찾을 수 없습니다: ${note.anchor.chapterHref}`)
    let doc = modified.get(chapterPath)
    if (!doc) { doc = xml((await entryBytes(input, chapterPath)).toString('utf8')); modified.set(chapterPath, doc) }
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
  const serializer = new XMLSerializer()
  for (const [name, doc] of modified) {
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
  add(`${PREFIX}commentary.css`, 'text/css', `.mdr-commentary{display:block;margin:1.2em 0;padding:.8em 1em;border-left:2px solid #927655;background:#f8f5ef;color:#302b25;font-size:.92em;line-height:1.65}.mdr-commentary .mdr-commentary{margin-left:.75em}.mdr-label,.mdr-origin{font:small sans-serif;color:#66594c}.mdr-commentary img{max-width:100%;height:auto}.mdr-commentary table{border-collapse:collapse;border-top:2px solid;border-bottom:2px solid}.mdr-commentary th,.mdr-commentary td{padding:.5em;vertical-align:top}.mdr-commentary th{border-bottom:1px solid}.mdr-deleted{font-style:italic}`)
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

export async function exportCommentaryEpub(sourcePath: string, destination: string, documentId: string) {
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
  const bytes = await compileCommentaryEpub(original, listCommentary(documentId))
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
