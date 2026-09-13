import fs from 'node:fs/promises'
import path from 'node:path'

const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif'
}

export async function readDocumentImage(documentPath: string, source: string): Promise<string | null> {
  if (!path.isAbsolute(documentPath) || /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return null
  try {
    const imagePath = path.resolve(path.dirname(documentPath), decodeURIComponent(source.split(/[?#]/)[0]))
    const mime = imageTypes[path.extname(imagePath).toLowerCase()]
    if (!mime) return null
    const file = await fs.open(imagePath, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null
      return `data:${mime};base64,${(await file.readFile()).toString('base64')}`
    } finally { await file.close() }
  } catch { return null }
}
