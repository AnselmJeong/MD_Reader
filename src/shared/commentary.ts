export interface CommentaryAnchor {
  chapterHref: string
  path: number[]
  quote: string
  elementId?: string
  tagName?: string
}

export interface CommentaryOrigin {
  messageId: string
  sessionId: string | null
  model: string
  content: string
}

export interface CommentaryNote {
  id: string
  documentId: string
  parentId: string | null
  anchor: CommentaryAnchor
  markdown: string
  html?: CommentaryHtml | null
  origin: CommentaryOrigin | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface CommentaryHtml {
  name: string
  content: string
}

export interface CommentaryAsset {
  id: string
  name: string
  dataUrl: string
}

export interface CommentarySnapshot {
  notes: CommentaryNote[]
  assets: CommentaryAsset[]
}

export interface SaveCommentary {
  id?: string
  documentId: string
  parentId: string | null
  anchor: CommentaryAnchor
  markdown: string
  html?: CommentaryHtml | null
  origin?: CommentaryOrigin | null
  expectedUpdatedAt?: number
}

export interface CommentaryAPI {
  onEscape: (callback: () => void) => () => void
  onChange: (callback: (documentId: string) => void) => () => void
  list: (documentId: string) => Promise<CommentarySnapshot>
  save: (params: SaveCommentary) => Promise<CommentaryNote>
  setDeleted: (documentId: string, id: string, deleted: boolean) => Promise<CommentaryNote>
  importImage: (documentId: string) => Promise<CommentaryAsset | null>
  importImageData: (documentId: string, dataUrl: string, name: string) => Promise<CommentaryAsset>
  importHtml: () => Promise<CommentaryHtml | null>
  permanentlyDelete: (documentId: string, id: string, expectedUpdatedAt: number) => Promise<boolean>
  exportEpub: (filePath: string, documentId: string) => Promise<{ filePath: string } | null>
}

export const commentaryText = (text: string) => text.replace(/\s+/g, ' ').trim()
export const commentaryAnchorKey = (anchor: CommentaryAnchor) => `${anchor.chapterHref}#${anchor.path.join('.')}`
