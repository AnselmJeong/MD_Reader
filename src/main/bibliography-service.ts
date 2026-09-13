import { readDocumentMetadata } from '../shared/document-metadata'
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
      if (/\.qmd$/i.test(documentPath)) {
        const metadata = readDocumentMetadata(await fs.readFile(documentPath, 'utf-8'))
        const declared = metadata.bibliography
        const sources = (Array.isArray(declared) ? declared : [declared]).filter((value): value is string => typeof value === 'string' && !!value.trim())
        if (sources.length) {
          const paths = sources.map(source => path.resolve(dir, source))
          bibFilePath = paths[0]
          if (paths.some(source => path.extname(source).toLowerCase() !== '.bib')) throw new Error('이 리더는 .bib 참고문헌 파일을 지원합니다.')
          const entries = await Promise.all(paths.map(source => fs.readFile(source, 'utf-8')))
          return { bibContent: entries.join('\n'), bibFilePath, customBibFilePath, bibError: null }
        }
      }
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
