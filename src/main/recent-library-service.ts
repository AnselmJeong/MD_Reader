import { app, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom'
import { readFileTolerant } from './safe-read'

export type RecentFileStatus = 'ok' | 'missing' | 'offline'
export interface RecentFileInfo { filePath: string; status: RecentFileStatus }
export interface RecentFileCover { title: string | null; author: string | null; cover: string | null }

const STAT_TIMEOUT_MS = 2500
const COVER_WIDTH = 320
const MAX_COVER_IMAGE_BYTES = 30 * 1024 * 1024

const withTimeout = <T>(promise: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms)
  promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
})

/** The mount point of a file under /Volumes, or null for files on the startup disk. */
function volumeRoot(filePath: string): string | null {
  const parts = path.resolve(filePath).split(path.sep)
  return parts[1] === 'Volumes' && parts[2] ? path.join('/', 'Volumes', parts[2]) : null
}

async function fileStatus(filePath: string): Promise<RecentFileStatus> {
  try {
    const stat = await withTimeout(fs.stat(filePath), STAT_TIMEOUT_MS)
    return stat.isFile() ? 'ok' : 'missing'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ETIMEDOUT') return 'offline'
    const root = volumeRoot(filePath)
    if (root) {
      // An unmounted NAS or external drive is not the same as a deleted file.
      try { await withTimeout(fs.access(root), STAT_TIMEOUT_MS) } catch { return 'offline' }
    }
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'offline'
  }
}

export async function getRecentFileInfo(paths: string[]): Promise<RecentFileInfo[]> {
  return Promise.all(paths.map(async filePath => ({ filePath, status: await fileStatus(filePath) })))
}

// ─── Covers ───

const coverDir = () => path.join(app.getPath('userData'), 'covers')
const memoryCache = new Map<string, RecentFileCover>()
const pending = new Map<string, Promise<RecentFileCover>>()

const elements = (node: { getElementsByTagName(name: string): ArrayLike<XmlElement> }, name: string) =>
  Array.from(node.getElementsByTagName(name) as ArrayLike<XmlElement>)
const firstText = (node: Parameters<typeof elements>[0], ...names: string[]) => {
  for (const name of names) {
    const text = elements(node, name)[0]?.textContent?.trim()
    if (text) return text
  }
  return null
}

function resolveZipPath(base: string, href: string) {
  const decoded = decodeURIComponent(href.split('#')[0])
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded)).replace(/^\/+/, '')
}

function findEntry(zip: JSZip, name: string) {
  return zip.file(name) ?? zip.file(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0] ?? null
}

async function epubCover(buffer: Buffer): Promise<RecentFileCover> {
  const zip = await JSZip.loadAsync(buffer)
  const container = await findEntry(zip, 'META-INF/container.xml')?.async('string')
  const opfPath = container?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1]
  const opfText = opfPath ? await findEntry(zip, opfPath)?.async('string') : null
  if (!opfPath || !opfText) return { title: null, author: null, cover: null }
  const opf = new DOMParser().parseFromString(opfText, 'application/xml')
  const title = firstText(opf, 'dc:title', 'title')
  const author = firstText(opf, 'dc:creator', 'creator')
  const items = elements(opf, 'item')
  const isImage = (item: XmlElement) => /^image\//i.test(item.getAttribute('media-type') ?? '') || /\.(jpe?g|png|gif|webp)$/i.test(item.getAttribute('href') ?? '')

  // EPUB 3 cover-image property, then the EPUB 2 <meta name="cover">, then name heuristics.
  let coverItem = items.find(item => /(^|\s)cover-image(\s|$)/.test(item.getAttribute('properties') ?? ''))
  if (!coverItem) {
    const coverId = elements(opf, 'meta').find(meta => meta.getAttribute('name') === 'cover')?.getAttribute('content')
    if (coverId) coverItem = items.find(item => item.getAttribute('id') === coverId && isImage(item))
  }
  if (!coverItem) coverItem = items.find(item => isImage(item) && /cover/i.test(`${item.getAttribute('id')} ${item.getAttribute('href')}`))
  let imagePath = coverItem?.getAttribute('href') ? resolveZipPath(opfPath, coverItem.getAttribute('href')!) : null

  // Some books only reference the cover image from the first (cover) page.
  if (!imagePath) {
    const firstSpine = elements(opf, 'itemref')[0]?.getAttribute('idref')
    const page = items.find(item => item.getAttribute('id') === firstSpine)
    const pagePath = page?.getAttribute('href') ? resolveZipPath(opfPath, page.getAttribute('href')!) : null
    const html = pagePath ? await findEntry(zip, pagePath)?.async('string') : null
    const src = html?.match(/<(?:img|image)\b[^>]*?(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']/i)?.[1]
    if (pagePath && src) imagePath = resolveZipPath(pagePath, src)
  }

  const entry = imagePath ? findEntry(zip, imagePath) : null
  if (!entry) return { title, author, cover: null }
  const bytes = await entry.async('nodebuffer')
  if (bytes.length > MAX_COVER_IMAGE_BYTES) return { title, author, cover: null }
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) return { title, author, cover: null }
  const resized = image.getSize().width > COVER_WIDTH ? image.resize({ width: COVER_WIDTH, quality: 'good' }) : image
  return { title, author, cover: `data:image/jpeg;base64,${resized.toJPEG(82).toString('base64')}` }
}

async function markdownTitle(filePath: string): Promise<RecentFileCover> {
  const text = (await readFileTolerant(filePath, 'utf-8')).slice(0, 8000)
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? ''
  const unquote = (value?: string) => value?.trim().replace(/^["']|["']$/g, '') || null
  const title = unquote(frontmatter.match(/^title:\s*(.+)$/m)?.[1]) ?? unquote(text.match(/^#\s+(.+)$/m)?.[1])
  const author = unquote(frontmatter.match(/^author:\s*(.+)$/m)?.[1])
  return { title, author, cover: null }
}

async function loadCover(filePath: string): Promise<RecentFileCover> {
  const stat = await withTimeout(fs.stat(filePath), STAT_TIMEOUT_MS)
  const key = createHash('sha1').update(`${path.resolve(filePath)}\0${stat.size}\0${stat.mtimeMs}`).digest('hex')
  const cached = memoryCache.get(key)
  if (cached) return cached
  const cacheFile = path.join(coverDir(), `${key}.json`)
  try {
    const stored = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as RecentFileCover
    memoryCache.set(key, stored)
    return stored
  } catch { /* not cached yet */ }

  const result = path.extname(filePath).toLowerCase() === '.epub'
    ? await epubCover(await readFileTolerant(filePath))
    : await markdownTitle(filePath)
  memoryCache.set(key, result)
  try {
    await fs.mkdir(coverDir(), { recursive: true })
    await fs.writeFile(cacheFile, JSON.stringify(result))
  } catch (error) { console.error('[Covers] Could not cache cover:', error) }
  return result
}

export function getRecentFileCover(filePath: string): Promise<RecentFileCover> {
  const existing = pending.get(filePath)
  if (existing) return existing
  const task = loadCover(filePath)
    .catch(error => {
      console.error(`[Covers] Could not read cover for ${filePath}:`, error)
      return { title: null, author: null, cover: null }
    })
    .finally(() => pending.delete(filePath))
  pending.set(filePath, task)
  return task
}
