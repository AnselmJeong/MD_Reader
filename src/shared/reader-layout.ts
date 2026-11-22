export type EpubSpreadMode = 'none' | 'always' | 'comments'
/** 2D: epub.js pages (all study tools). 3D: a hardcover book for relaxed reading. */
export type EpubViewMode = '2d' | '3d'
export interface ReaderLayout {
  chatWidth: number
  showChat: boolean
  showToC: boolean
  focusMode: boolean
  epubSpreadMode: EpubSpreadMode
  epubViewMode: EpubViewMode
}

export const defaultReaderLayout: ReaderLayout = {
  chatWidth: 320, showChat: true, showToC: false, focusMode: false, epubSpreadMode: 'always', epubViewMode: '2d'
}

export function restoreReaderLayout(value: unknown): ReaderLayout {
  const data = value && typeof value === 'object' ? value as Partial<ReaderLayout> : {}
  return {
    chatWidth: typeof data.chatWidth === 'number' && Number.isFinite(data.chatWidth) ? Math.round(Math.min(800, Math.max(300, data.chatWidth))) : 320,
    showChat: typeof data.showChat === 'boolean' ? data.showChat : true,
    showToC: typeof data.showToC === 'boolean' ? data.showToC : false,
    focusMode: typeof data.focusMode === 'boolean' ? data.focusMode : false,
    epubSpreadMode: ['none', 'always', 'comments'].includes(data.epubSpreadMode ?? '') ? data.epubSpreadMode! : 'always',
    epubViewMode: data.epubViewMode === '3d' ? '3d' : '2d'
  }
}
