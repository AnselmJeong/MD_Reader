import { useMemo } from 'react'
import type { CommentaryHtml } from '../../../../shared/commentary'
import { renderCommentaryHtml } from '../../../../shared/commentary-html'

export function CommentaryHtmlView({ html }: { html: CommentaryHtml }) {
  const content = useMemo(() => renderCommentaryHtml(html), [html.content, html.name])
  return <iframe className="commentary-html-frame" title={`HTML 주석: ${html.name}`}
    sandbox="" referrerPolicy="no-referrer" srcDoc={content}
    style={{ display: 'block', width: '100%', height: 'min(60vh, 600px)', minHeight: 240, border: '1px solid #9c846344', borderRadius: 6, background: '#fff' }} />
}
