import { memo, useMemo } from 'react'
import { authorNames, metadataText, readDocumentMetadata } from '../../../../shared/document-metadata'

interface MetadataCardProps {
  content: string
  hideTitle?: boolean
}

export const MetadataCard = memo(function MetadataCard({ content, hideTitle = false }: MetadataCardProps) {
  const metadata = useMemo(() => readDocumentMetadata(content), [content])
  const title = metadataText(metadata.title)
  const authorStr = authorNames(metadata.authors || metadata.author)
  const date = metadataText(metadata.date)
  const abstract = metadataText(metadata.abstract)
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords.map(metadataText).filter(Boolean) : []
  if ((!title || hideTitle) && !authorStr && !date && !abstract && !keywords.length) return null

  return (
    <div className="metadata-card">
      {!hideTitle && title && <h1>{title}</h1>}
      {authorStr && <div className="meta-authors">{authorStr}</div>}
      {date && <div className="meta-date">{date}</div>}
      {keywords.length > 0 && (
        <div className="meta-keywords">
          {keywords.map((kw, i) => (
            <span key={i} className="meta-keyword">{kw}</span>
          ))}
        </div>
      )}
      {abstract && (
        <div className="meta-abstract">{abstract}</div>
      )}
    </div>
  )
})
