// From the repository root, after npm run build:
// npx esbuild tests/citation-hover.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/citation-hover.cjs
// node_modules/.bin/electron .tmp/citation-hover.cjs
import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-bib-ui-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const doc = path.join(fixture, 'paper.md')
const sibling = path.join(fixture, 'paper.bib')
const custom = path.join(fixture, 'custom.bib')
fs.writeFileSync(doc, '# Citation smoke test\n\n[@Smith2024; @NoDoi]에 따른다.\n\n[Smith 2024](#ref-Smith2024)\n')
fs.writeFileSync(sibling, '@article{Smith2024, title={Automatic title}, year={2024}, doi={10.1234/automatic}}')
fs.writeFileSync(custom, '@article{Smith2024, title={Custom {EEG} title}, year={2024}, doi={doi:10.1234/custom}}\n@article{NoDoi, title={No DOI paper}}')
let selected = doc
let canceled = false
let opened: string[] = []
dialog.showOpenDialog = async () => ({ canceled, filePaths: canceled ? [] : [selected] })
shell.openExternal = async (url) => { opened.push(url) }

app.whenReady().then(async () => {
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  const { readDocumentFile } = require('../src/main/file-service')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1200, height: 850, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => {
    for (let i = 0; i < 100; i++) {
      if (await run(code)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Timed out: ' + code)
  }
  const click = async (selector: string) => { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); }
  const hover = async (selector: string) => {
    const rect = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...rect })
  }
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await click('button[title="Open File (⌘O)"]')
    await wait(`!!document.querySelector('[data-cite-key="Smith2024"]')`)
    assert.equal(await run(`document.querySelector('[data-cite-key="Smith2024"]').textContent`), '[1]')
    assert.equal(await run(`document.querySelector('[data-cite-key="NoDoi"]').textContent`), '[2]')
    assert.equal(await run(`getComputedStyle(document.querySelector('[data-cite-key="Smith2024"]').closest('p'), '::first-letter').float`), 'none')
    win.focus()
    await new Promise((r) => setTimeout(r, 300))
    await hover('[data-cite-key="Smith2024"]')
    await wait(`document.body.textContent.includes('Automatic title')`)
    await hover('a[href="https://doi.org/10.1234/automatic"]')
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(await run(`!!document.querySelector('a[href="https://doi.org/10.1234/automatic"]')`), true)
    await click('a[href="https://doi.org/10.1234/automatic"]')
    await wait(`!document.querySelector('[role="alert"]')`)
    assert.deepEqual(opened, ['https://doi.org/10.1234/automatic'])
    await click('button[title="Bibliography for this document"]')
    selected = custom
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Choose .bib')).click()`)
    await wait(`document.body.textContent.includes('Bib · Custom')`)
    assert.equal((await readDocumentFile(doc)).customBibFilePath, custom)
    assert.equal(await run(`document.querySelector('[data-cite-key="Smith2024"]').textContent`), '[1]')
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'profile', 'md-reader-files.json'), 'utf8')).bibliographyPaths[doc], custom)
    await hover('[data-cite-key="Smith2024"]')
    await wait(`document.body.textContent.includes('Custom EEG title')`)
    await hover('a[href="https://doi.org/10.1234/custom"]')
    await new Promise((r) => setTimeout(r, 400))
    await click('a[href="https://doi.org/10.1234/custom"]')
    assert.deepEqual(opened, ['https://doi.org/10.1234/automatic', 'https://doi.org/10.1234/custom'])
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 700 })
    await new Promise((r) => setTimeout(r, 300))
    await hover('[data-cite-key="NoDoi"]')
    await wait(`document.body.textContent.includes('No DOI paper')`)
    assert.equal(await run(`Array.from(document.querySelectorAll('a')).some(a=>a.textContent.includes('No DOI paper'))`), false)
    // Verify a canceled native picker does not discard the selected bibliography.
    canceled = true
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Choose .bib')).click()`)
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Choose .bib'))`)
    assert.equal((await readDocumentFile(doc)).customBibFilePath, custom)
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Use automatic')).click()`)
    await wait(`!document.body.textContent.includes('Bib · Custom')`)
    assert.equal((await readDocumentFile(doc)).customBibFilePath, null)
    await hover('[data-cite-key="Smith2024"]')
    await wait(`document.body.textContent.includes('Automatic title')`)
    // Check keyboard focus resolves the same raw key.
    await run(`document.querySelector('[data-cite-key="Smith2024"]').focus()`)
    await wait(`document.body.textContent.includes('Automatic title')`)
    fs.writeFileSync(path.resolve('.tmp/raw-citation-smoke.png'), (await win.webContents.capturePage()).toPNG())
    assert.ok(fs.readFileSync(doc, 'utf8').includes('[@Smith2024; @NoDoi]'))
    console.log('PASS: IEEE numbers, original source preserved, pointer hover, keyboard focus, custom bib picker/cancel/reset/persistence, DOI and no-DOI.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    fs.writeFileSync(path.resolve('.tmp/raw-citation-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
