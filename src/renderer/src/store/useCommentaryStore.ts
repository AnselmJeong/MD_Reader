import { create } from 'zustand'
import type { CommentaryAnchor, CommentaryOrigin, CommentaryHtml, SaveCommentary } from '../../../shared/commentary'
import { resolveCommentaryContent } from '../../../shared/commentary-html'

interface CommentaryDraft extends SaveCommentary { markdown: string }
interface CommentaryState {
  draft: CommentaryDraft | null
  selecting: boolean
  candidate: CommentaryAnchor | null
  target: { documentId: string; anchor: CommentaryAnchor } | null
  open: (documentId: string, markdown?: string, origin?: CommentaryOrigin) => void
  edit: (draft: CommentaryDraft) => void
  choose: (documentId: string, anchor: CommentaryAnchor) => void
  setMarkdown: (markdown: string) => void
  setHtml: (html: CommentaryHtml | null) => void
  pick: () => void
  confirmPick: () => void
  cancelPick: () => void
  close: () => void
}

export const useCommentaryStore = create<CommentaryState>((set, get) => ({
  draft: null, selecting: false, candidate: null, target: null,
  open: (documentId, markdown = '', origin) => {
    const target = get().target
    const anchor = target?.documentId === documentId ? target.anchor : null
    // An unplaced draft has no usable source anchor until the reader picks a paragraph.
    set({ draft: { documentId, parentId: null, anchor: anchor ?? { chapterHref: '', path: [], quote: '' }, markdown, origin }, selecting: !anchor, candidate: null })
  },
  edit: (draft) => set({ draft: { ...draft, ...resolveCommentaryContent(draft) }, selecting: false, candidate: null }),
  choose: (documentId, anchor) => set(state => state.selecting
    ? (state.draft?.documentId === documentId ? { candidate: anchor } : {})
    : { target: { documentId, anchor } }),
  setMarkdown: (markdown) => set(state => ({ draft: state.draft ? { ...state.draft, markdown } : null })),
  setHtml: (html) => set(state => ({ draft: state.draft ? { ...state.draft, html } : null })),
  pick: () => set({ selecting: true, candidate: null }),
  confirmPick: () => set(state => state.draft && state.candidate ? {
    draft: { ...state.draft, anchor: state.candidate },
    target: { documentId: state.draft.documentId, anchor: state.candidate },
    selecting: false, candidate: null
  } : {}),
  cancelPick: () => set({ selecting: false, candidate: null }),
  close: () => set({ draft: null, selecting: false, candidate: null })
}))
