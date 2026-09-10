import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { SimpleStore } from './simple-store'
import { getEpubReadingProgress } from './epub-reading-progress-service'
import { readBibliography } from './bibliography-service'
import type { BibliographyResult } from '../shared/bibliography'

interface FileStoreData {
  recentFiles: string[]
  bibliographyPaths: Record<string, string>
}

export type DocumentFileResult =
  | (BibliographyResult & {
      kind: 'markdown'
      filePath: string
      content: string
      documentHash: string
    })
  | {
      kind: 'epub'
      filePath: string
      content: string
      documentHash: string
      epubBase64: string
      lastCfi: string | null
      lastChapterHref: string | null
      lastChapterLabel: string | null
      lastProgress: number | null
      bibContent: null
    }

const store = new SimpleStore<FileStoreData>('md-reader-files', {
  recentFiles: [],
  bibliographyPaths: {}
})

const MAX_RECENT = 20

export async function readFileWithBib(filePath: string): Promise<{ content: string } & BibliographyResult> {
  const customPath = store.get('bibliographyPaths')[path.resolve(filePath)] ?? null
  const [content, bibliography] = await Promise.all([
    fs.readFile(filePath, 'utf-8'),
    readBibliography(filePath, customPath)
  ])
  return { content, ...bibliography }
}

export async function setDocumentBibliography(filePath: string, bibPath: string | null): Promise<BibliographyResult> {
  const bibliography = await readBibliography(filePath, bibPath)
  // Keep the previous selection if a newly selected file cannot be read.
  if (bibPath && bibliography.bibError) throw new Error(bibliography.bibError)
  const paths = { ...store.get('bibliographyPaths') }
  if (bibPath) paths[path.resolve(filePath)] = bibPath
  else delete paths[path.resolve(filePath)]
  store.set('bibliographyPaths', paths)
  return bibliography
}

export async function readDocumentFile(filePath: string): Promise<DocumentFileResult> {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.epub') {
    const buffer = await fs.readFile(filePath)
    const documentHash = createHash('sha256').update(buffer).digest('hex')
    const progress = getEpubReadingProgress({
      documentId: documentHash,
      filePath
    })

    return {
      kind: 'epub',
      filePath,
      content: '',
      documentHash,
      epubBase64: buffer.toString('base64'),
      lastCfi: progress?.cfi ?? null,
      lastChapterHref: progress?.chapterHref ?? null,
      lastChapterLabel: progress?.chapterLabel ?? null,
      lastProgress: progress?.progress ?? null,
      bibContent: null
    }
  }

  const { content, ...bibliography } = await readFileWithBib(filePath)
  return {
    kind: 'markdown',
    filePath,
    content,
    documentHash: createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex'),
    ...bibliography
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8')
}

export function getRecentFiles(): string[] {
  return store.get('recentFiles') || []
}

export async function addRecentFile(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  let recent = getRecentFiles()
  recent = recent.filter((f) => f !== resolved)
  recent.unshift(resolved)
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT)
  store.set('recentFiles', recent)
}
