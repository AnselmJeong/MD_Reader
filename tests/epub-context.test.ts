import assert from 'node:assert/strict'
import { useDocumentStore } from '../src/renderer/src/store/useDocumentStore'
const epub = { kind: 'epub', filePath: '/fixture/book.epub', content: '', documentHash: 'original', epubBase64: 'base64' } as const
const store = useDocumentStore
store.getState().setDocument(epub)
store.getState().updateEpubContent(epub.filePath, 'Chapter four describes 90 regions and 89 participants.')
store.getState().updateEpubLocation(epub.filePath, 'cfi', 'ch004.xhtml', 'Chapter four', 0.2)
store.getState().setDocument(epub)
assert.equal(store.getState().content, 'Chapter four describes 90 regions and 89 participants.')
assert.equal(store.getState().wordCount, 8)
assert.equal(store.getState().activeTab?.kind === 'epub' && store.getState().activeTab?.currentChapterHref, 'ch004.xhtml')
store.getState().setDocument({ ...epub, documentHash: 'changed' })
assert.equal(store.getState().content, '')
console.log('PASS duplicate EPUB open preserves displayed chapter context; changed files reset context')
