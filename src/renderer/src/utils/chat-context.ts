import type { ChatContextMeta } from '../global'
import type { DocumentTab } from '../store/useDocumentStore'

function getPrimaryHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.replace(/[*_`]/g, '').trim() || null
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

export function getChatContextMeta(tab: DocumentTab | null): ChatContextMeta | null {
  if (!tab) return null

  if (tab.kind === 'markdown') {
    return {
      documentKind: 'markdown',
      documentId: `sha256:${tab.documentHash}`,
      fileName: tab.fileName,
      lastFilePath: tab.filePath,
      contextTitle: getPrimaryHeading(tab.content) ?? stripExtension(tab.fileName),
      contentHash: tab.documentHash
    }
  }

  if (!tab.currentChapterHref && !tab.currentChapterLabel) return null

  const chapterTitle = tab.currentChapterLabel ?? 'Current chapter'
  return {
    documentKind: 'epub',
    documentId: `sha256:${tab.documentHash}`,
    fileName: tab.fileName,
    lastFilePath: tab.filePath,
    contextTitle: `${stripExtension(tab.fileName)} / ${chapterTitle}`,
    chapterHref: tab.currentChapterHref,
    chapterLabel: tab.currentChapterLabel,
    lastCfi: tab.currentLocation,
    contentHash: tab.documentHash
  }
}

export function getProposedContextKey(meta: ChatContextMeta | null): string | null {
  if (!meta) return null
  if (meta.documentKind === 'markdown') return `md:${meta.documentId}`
  return `epub:${meta.documentId}#${meta.chapterHref ?? meta.chapterLabel ?? 'unknown'}`
}
