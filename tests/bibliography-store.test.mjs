import assert from 'node:assert/strict'
import test from 'node:test'
import { useDocumentStore } from '../src/renderer/src/store/useDocumentStore.ts'

const bibliography = (path) => ({ bibContent: `bibliography ${path}`, bibFilePath: path, customBibFilePath: path, bibError: null })
const document = (path) => ({ kind: 'markdown', filePath: path, content: '# Original', documentHash: path, ...bibliography(null) })

test('changing bibliography preserves unsaved edits and updates only the intended tab', () => {
  const store = useDocumentStore
  store.getState().clearDocument()
  store.getState().setDocument(document('/first.md'))
  store.getState().updateContent('# Unsaved edits')
  store.getState().setDocument(document('/second.md'))
  store.getState().updateBibliography('/first.md', bibliography('/custom.bib'))
  assert.equal(store.getState().activeTabId, '/second.md')
  assert.equal(store.getState().bibContent, 'bibliography null')
  store.getState().selectTab('/first.md')
  assert.equal(store.getState().content, '# Unsaved edits')
  assert.equal(store.getState().isDirty, true)
  assert.equal(store.getState().bibContent, 'bibliography /custom.bib')
  assert.equal(store.getState().activeTab.customBibFilePath, '/custom.bib')
  store.getState().closeTab('/first.md')
  store.getState().updateBibliography('/first.md', bibliography('/late.bib'))
  assert.equal(store.getState().tabs.length, 1)
  assert.equal(store.getState().activeTabId, '/second.md')
  store.getState().clearDocument()
})
