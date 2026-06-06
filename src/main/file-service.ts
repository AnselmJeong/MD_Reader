import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { SimpleStore } from './simple-store'

interface FileStoreData {
  recentFiles: string[]
}

export type DocumentFileResult =
  | {
      kind: 'markdown'
      filePath: string
      content: string
      documentHash: string
      bibContent: string | null
    }
  | {
      kind: 'epub'
      filePath: string
      content: string
      documentHash: string
      epubBase64: string
      bibContent: null
    }

const store = new SimpleStore<FileStoreData>('md-reader-files', {
  recentFiles: []
})

const MAX_RECENT = 20

export async function readFileWithBib(filePath: string): Promise<{ content: string; bibContent: string | null }> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    
    // Look for sibling .bib file
    const dir = path.dirname(filePath)
    let bibContent: string | null = null
    try {
      const files = await fs.readdir(dir)
      // Prioritize same name (e.g. document.md -> document.bib), then any .bib
      const basename = path.basename(filePath, path.extname(filePath))
      const specificBib = files.find(f => f === `${basename}.bib`)
      const anyBib = files.find(f => f.endsWith('.bib'))
      
      const bibFile = specificBib || anyBib
      if (bibFile) {
        bibContent = await fs.readFile(path.join(dir, bibFile), 'utf-8')
      }
    } catch {
      // Ignore bib read errors
    }

    return { content, bibContent }
  } catch (error) {
    throw error
  }
}

export async function readDocumentFile(filePath: string): Promise<DocumentFileResult> {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.epub') {
    const buffer = await fs.readFile(filePath)
    return {
      kind: 'epub',
      filePath,
      content: '',
      documentHash: createHash('sha256').update(buffer).digest('hex'),
      epubBase64: buffer.toString('base64'),
      bibContent: null
    }
  }

  const { content, bibContent } = await readFileWithBib(filePath)
  return {
    kind: 'markdown',
    filePath,
    content,
    documentHash: createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex'),
    bibContent
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
