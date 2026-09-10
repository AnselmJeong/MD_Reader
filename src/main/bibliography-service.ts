import fs from 'fs/promises'
import path from 'path'
import type { BibliographyResult } from '../shared/bibliography'

export async function readBibliography(
  documentPath: string,
  customBibFilePath: string | null = null
): Promise<BibliographyResult> {
  let bibFilePath = customBibFilePath
  try {
    if (!bibFilePath) {
      const dir = path.dirname(documentPath)
      const files = await fs.readdir(dir)
      const basename = path.basename(documentPath, path.extname(documentPath))
      const bibFile = files.find((file) => file === `${basename}.bib`)
        || files.find((file) => file.toLowerCase().endsWith('.bib'))
      if (bibFile) bibFilePath = path.join(dir, bibFile)
    }
    if (bibFilePath && path.extname(bibFilePath).toLowerCase() !== '.bib') {
      throw new Error('Please choose a .bib file.')
    }
    const bibContent = bibFilePath ? await fs.readFile(bibFilePath, 'utf-8') : null
    return { bibContent, bibFilePath, customBibFilePath, bibError: null }
  } catch (error) {
    return {
      bibContent: null,
      bibFilePath,
      customBibFilePath,
      bibError: `Could not read bibliography: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
