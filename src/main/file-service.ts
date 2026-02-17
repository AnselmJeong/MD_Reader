import fs from 'fs/promises'
import path from 'path'
import { SimpleStore } from './simple-store'

interface FileStoreData {
  recentFiles: string[]
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
