import { useMemo } from 'react'
import type { CommentaryNote } from '../../../../shared/commentary'
import { renderCommentary } from '../../../../shared/commentary-markdown'
import { CommentaryHtmlView } from './CommentaryHtmlView'

export function CommentaryReadNote({ note, notes, urls }: { note: CommentaryNote; notes: CommentaryNote[]; urls: Record<string, string> }) {
  const body = useMemo(() => renderCommentary(note.markdown, urls, true), [note.markdown, urls])
  return <article className="commentary-reading-note" data-reading-note-id={note.id}>
    {note.deletedAt ? <p>삭제된 주석</p> : <>
      {note.markdown && <div className="commentary-prose" dangerouslySetInnerHTML={{ __html: body }} />}
      {note.html && <CommentaryHtmlView html={note.html} />}
    </>}
    {notes.filter(child => child.parentId === note.id).map(child => <section className="commentary-reading-reply" key={child.id}>
      <p className="commentary-reply-label">답글</p><CommentaryReadNote note={child} notes={notes} urls={urls} />
    </section>)}
  </article>
}
