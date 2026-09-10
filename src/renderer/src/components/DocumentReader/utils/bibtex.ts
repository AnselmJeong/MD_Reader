export interface BibEntry {
  key: string
  title: string | null
  author: string | null
  year: string | null
  journal: string | null
  doi: string | null
}

export interface BibIndex {
  byKey: Record<string, BibEntry>
  byDoi: Record<string, BibEntry>
  byAuthorYear: Record<string, BibEntry>
}

export function parseBibTeX(content: string): Record<string, BibEntry> {
  const entries: Record<string, BibEntry> = {}
  const rawEntries = content.split('@').slice(1)

  rawEntries.forEach((raw) => {
    try {
      const firstBrace = raw.indexOf('{')
      const firstComma = raw.indexOf(',')
      if (firstBrace === -1 || firstComma === -1) return

      const key = raw.slice(firstBrace + 1, firstComma).trim()

      const extractField = (fieldName: string) => {
        const regex = new RegExp(`(?:^|,)\\s*${fieldName}\\s*=\\s*`, 'i')
        const match = regex.exec(raw)
        if (!match) return null
        const start = match.index + match[0].length
        const opener = raw[start]
        let end = start
        if (opener === '{' || opener === '"') {
          let depth = opener === '{' ? 1 : 0
          for (end = start + 1; end < raw.length; end += 1) {
            if (raw[end] === '\\') { end += 1; continue }
            if (raw[end] === '{') depth += 1
            if (raw[end] === '}') {
              depth -= 1
              if (opener === '{' && depth === 0) break
            }
            if (opener === '"' && raw[end] === '"' && depth === 0) break
          }
        } else {
          while (end < raw.length && !/[,}\n]/.test(raw[end])) end += 1
        }
        return raw.slice(start + (opener === '{' || opener === '"' ? 1 : 0), end)
          .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
      }

      entries[key.toLowerCase()] = {
        key,
        title: extractField('title'),
        author: extractField('author'),
        year: extractField('year'),
        journal: extractField('journal'),
        doi: extractField('doi')
      }
    } catch {
      // Ignore malformed entries.
    }
  })

  return entries
}

export function normalizeDoi(value: string | null): string | null {
  if (!value) return null
  let doi = value.trim().replace(/^doi:\s*/i, '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
  try { doi = decodeURIComponent(doi) } catch { return null }
  return /^10\.\d{4,9}\/[^\s]+$/i.test(doi) ? doi : null
}

export function getDoiUrl(value: string | null): string | null {
  const doi = normalizeDoi(value)
  return doi ? `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` : null
}

export function buildBibIndex(content: string | null): BibIndex {
  if (!content) {
    return { byKey: {}, byDoi: {}, byAuthorYear: {} }
  }

  const byKey = parseBibTeX(content)
  const byDoi: Record<string, BibEntry> = {}
  const byAuthorYear: Record<string, BibEntry> = {}

  Object.values(byKey).forEach((entry) => {
    if (entry.doi) {
      const cleanDoi = normalizeDoi(entry.doi)?.toLowerCase()
      if (cleanDoi) byDoi[cleanDoi] = entry
    }

    if (!entry.author || !entry.year) return

    let author = entry.author.split(' and ')[0].trim()
    if (author.includes(',')) {
      author = author.split(',')[0].trim()
    } else {
      const parts = author.split(' ')
      author = parts[parts.length - 1].trim()
    }

    author = author.replace(/[^a-zA-Z]/g, '').toLowerCase()
    const year = entry.year.replace(/[^0-9]/g, '')
    if (!author || !year) return

    const key = `${author}_${year}`
    if (!byAuthorYear[key]) {
      byAuthorYear[key] = entry
    }
  })

  return { byKey, byDoi, byAuthorYear }
}

export function formatBibEntry(entry: BibEntry): string {
  const parts: string[] = []
  if (entry.title) parts.push(entry.title)
  if (entry.year) parts.push(`(${entry.year})`)
  return parts.join(' ')
}

export function findBibEntryForExternalLink(href: string, text: string, index: BibIndex): BibEntry | null {
  const doi = /^https?:\/\/(dx\.)?doi\.org\//i.test(href) ? normalizeDoi(href) : null
  if (doi) {
    const byDoiEntry = index.byDoi[doi.toLowerCase()]
    if (byDoiEntry) return byDoiEntry
  }

  const authorYearMatch = text.match(/([A-Z][a-zA-Z\u00C0-\u00FF]+)(?:.*?et al\.?)?.*?(\d{4})/u)
  if (!authorYearMatch) return null

  const key = `${authorYearMatch[1].toLowerCase()}_${authorYearMatch[2]}`
  return index.byAuthorYear[key] || null
}

export function findBibEntryForInternalLink(targetId: string, index: BibIndex): BibEntry | null {
  const cleanKey = targetId.replace(/^(ref-|bib-|cite-)/i, '').toLowerCase()
  return index.byKey[cleanKey] || index.byKey[targetId.toLowerCase()] || null
}
