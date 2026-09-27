// After npm run build: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/reader-selection.smoke.cjs
const { app, dialog } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-selection-'))
app.setPath('userData', fixture)
const documentPath = path.join(fixture, 'selection.md')
const passage = 'Selected text remains available for reading and annotation.'
fs.writeFileSync(documentPath, `# Selection test\n\n${passage}\n`)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [documentPath] })
const timeout = setTimeout(() => { console.error('Selection smoke timed out'); app.exit(1) }, 30000)

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code)
    const wait = async code => {
      for (let i = 0; i < 100; i++) {
        if (await run(code)) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error(`Timed out: ${code}`)
    }
    const selectPassage = async () => {
      await run(`(() => {
        const paragraph = document.querySelector('.document-body p')
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })()`)
      await wait(`!!document.querySelector('[data-selection-menu]')`)
    }
    const clickSelectionAction = label => run(`Array.from(document.querySelectorAll('[data-selection-menu] button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`)
    try {
      await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
      assert.equal(await run(`'tts' in window.api`), false)
      assert.equal(await run(`!!document.querySelector('button[title="Read document"]')`), false)
      await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
      await wait(`!!document.querySelector('.document-body p')`)
      await run(`void (navigator.clipboard.writeText = async text => { window.copiedSelectionForTest = text })`)
      await selectPassage()
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-selection-menu] button')).map(button => button.textContent.trim())`), ['Ask AI', 'Summarize', 'Highlight', 'Copy'])
      await clickSelectionAction('Copy')
      await wait(`!document.querySelector('[data-selection-menu]')`)
      assert.equal(await run(`window.copiedSelectionForTest`), passage)
      await selectPassage()
      await clickSelectionAction('Ask AI')
      await wait(`!document.querySelector('[data-selection-menu]')`)
      await wait(`!!document.querySelector('button[title="Remove selected passage"]')`)
      assert.equal(await run(`document.querySelector('button[title="Remove selected passage"]').parentElement.parentElement.querySelector('p').textContent`), passage)
      await selectPassage()
      await clickSelectionAction('Highlight')
      await wait(`!!document.querySelector('button[aria-label="Yellow highlight"]')`)
      await run(`document.querySelector('button[aria-label="Yellow highlight"]').click()`)
      await wait(`!!document.querySelector('.document-body mark')`)
      assert.equal(await run(`document.querySelector('.document-body mark').textContent`), passage)
      await run(`document.querySelector('button[title="Search (⌘F)"]').click()`)
      await wait(`!!document.querySelector('[data-search-panel]')`)
      await run(`document.querySelector('button[title="Settings"]').click()`)
      await wait(`document.body.textContent.includes('Agent Memory')`)
      assert.equal(await run(`document.body.textContent.includes('Text to Speech')`), false)
      assert.equal(await run(`document.body.textContent.includes('Christopher')`), false)
      console.log('PASS: no TTS API/UI; selection Copy, Ask AI, Highlight, search and settings work.')
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
})
app.on('will-quit', () => fs.rmSync(fixture, { recursive: true, force: true }))
require(path.resolve('out/main/index.js'))
