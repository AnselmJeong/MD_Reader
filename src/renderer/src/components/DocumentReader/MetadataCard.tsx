import { useMemo } from 'react'
import { parse as parseYaml } from 'yaml'

interface MetadataCardProps {
  content: string
}

interface FrontMatter {
  title?: string
  authors?: string | string[]
  author?: string | string[]
  date?: string
  keywords?: string[]
  abstract?: string
}

export function MetadataCard({ content }: MetadataCardProps) {
  const metadata = useMemo<FrontMatter | null>(() => {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null
    try {
      return parseYaml(match[1]) as FrontMatter
    } catch {
      return null
    }
  }, [content])

  if (!metadata?.title) return null

  const authors = metadata.authors || metadata.author
  const authorStr = Array.isArray(authors) ? authors.join(', ') : authors

  return (
    <div className="metadata-card">
      <h1>{metadata.title}</h1>
      {authorStr && <div className="meta-authors">{authorStr}</div>}
      {metadata.date && <div className="meta-date">{metadata.date}</div>}
      {metadata.keywords && metadata.keywords.length > 0 && (
        <div className="meta-keywords">
          {metadata.keywords.map((kw, i) => (
            <span key={i} className="meta-keyword">{kw}</span>
          ))}
        </div>
      )}
      {metadata.abstract && (
        <div className="meta-abstract">{metadata.abstract}</div>
      )}
    </div>
  )
}
