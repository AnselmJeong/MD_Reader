import { parse as parseYaml } from 'yaml'

export function splitFrontmatter(source: string): { yaml: string | null; body: string } {
  const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)
  return match ? { yaml: match[1], body: source.slice(match[0].length) } : { yaml: null, body: source }
}

export function readDocumentMetadata(source: string): Record<string, unknown> {
  const { yaml } = splitFrontmatter(source)
  if (yaml === null) return {}
  try {
    const value: unknown = parseYaml(yaml, { maxAliasCount: 100 })
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

export function metadataText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function authorNames(value: unknown, depth = 0): string {
  if (depth > 8) return ''
  if (Array.isArray(value)) return value.map(item => authorNames(item, depth + 1)).filter(Boolean).join(', ')
  if (value && typeof value === 'object') {
    const author = value as Record<string, unknown>
    if (author.name) return authorNames(author.name, depth + 1)
    return [metadataText(author.given), metadataText(author.family)].filter(Boolean).join(' ')
  }
  return metadataText(value)
}
