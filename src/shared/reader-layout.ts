export type EpubSpreadMode = 'none' | 'always' | 'comments'
export interface ReaderLayout {
  chatWidth: number
  showChat: boolean
  showToC: boolean
  focusMode: boolean
  epubSpreadMode: EpubSpreadMode
}

export const defaultReaderLayout: ReaderLayout = {
  chatWidth: 320, showChat: true, showToC: false, focusMode: false, epubSpreadMode: 'always'
}

export function restoreReaderLayout(value: unknown): ReaderLayout {
  const data = value && typeof value === 'object' ? value as Partial<ReaderLayout> : {}
  return {
    chatWidth: typeof data.chatWidth === 'number' && Number.isFinite(data.chatWidth) ? Math.round(Math.min(800, Math.max(300, data.chatWidth))) : 320,
    showChat: typeof data.showChat === 'boolean' ? data.showChat : true,
    showToC: typeof data.showToC === 'boolean' ? data.showToC : false,
    focusMode: typeof data.focusMode === 'boolean' ? data.focusMode : false,
    epubSpreadMode: ['none', 'always', 'comments'].includes(data.epubSpreadMode ?? '') ? data.epubSpreadMode! : 'always'
  }
}
