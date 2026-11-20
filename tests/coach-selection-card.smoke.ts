// After npm run build:
// node tests/build-smoke.mjs tests/coach-selection-card.smoke.ts .tmp/coach-selection-card.cjs
// node_modules/.bin/electron .tmp/coach-selection-card.cjs
// The model call is replaced by tests/helpers/coach-model-mock.ts (see build-smoke.mjs).
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-coach-card-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const file = path.join(fixture, 'coach.epub')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Coach</title></head><body>${body}</body></html>`
const filler = Array.from({ length: 6 }, (_, i) => `<p>Filler paragraph ${i} about the slow work of naming barnacles, one specimen at a time, in Down House.</p>`).join('')

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('OEBPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">coach-card-test</dc:identifier><dc:title>Coach card test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`)
  zip.file('OEBPS/nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="Text/chapter1.xhtml">Barnacles</a></li><li><a href="Text/chapter2.xhtml">Next</a></li></ol></nav>'))
  zip.file('OEBPS/Text/chapter1.xhtml', xhtml(`<h1>Barnacles</h1><p>The genus <i>Cryptophialus minutus</i> is named here first.</p><p>Cryptophialus minutus again, before the place the reader selects.</p><p id="target">Darwin described <i>Cryptophialus minutus</i>, a tiny burrowing barnacle, in his monograph.</p>${filler}`))
  zip.file('OEBPS/Text/chapter2.xhtml', xhtml('<h1>Next</h1><p>Another chapter.</p>'))
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const open = () => new BrowserWindow({ show: true, width: 1200, height: 850, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const win = open()
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string, label = code) => {
    for (let i = 0; i < 200; i++) {
      if (await run(code)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Timed out: ' + label)
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const frameDoc = `Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).find(d => d?.getElementById('target'))`
  const marks = () => run(`(() => { const d = ${frameDoc}; const h = d?.defaultView.CSS.highlights.get('md-reader-coach'); return h ? h.size : 0 })()`)
  const phraseCenter = () => run(`(() => { const d = ${frameDoc}; const i = d.querySelector('#target i'); const r = i.getClientRects()[0]; const f = d.defaultView.frameElement.getBoundingClientRect(); return { x: Math.round(f.x + r.x + r.width / 2), y: Math.round(f.y + r.y + r.height / 2) } })()`)
  const markInTarget = () => run(`(() => { const d = ${frameDoc}; const h = d.defaultView.CSS.highlights.get('md-reader-coach'); const r = h && [...h][0]; return !!r && d.getElementById('target').contains(r.startContainer) })()`)
  const move = (x: number, y: number) => win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  const openBook = async () => {
    // A restored session can start its own navigation, which aborts this load; the page still loads.
    await win.loadFile(path.resolve('out/renderer/index.html')).catch(() => undefined)
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!(${frameDoc})`, 'chapter rendered')
    win.focus()
    await pause(800)
  }
  try {
    await openBook()
    // Select the italic phrase (it wraps across a line, like most real selections).
    await run(`(() => { const d = ${frameDoc}; const r = d.createRange(); r.selectNodeContents(d.querySelector('#target i')); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
    await wait(`Array.from(document.querySelectorAll('[data-selection-menu] button')).some(b => b.textContent.includes('코치 카드'))`, 'selection menu')
    const selected = await run(`(${frameDoc}).getSelection().toString()`)
    console.log('selected:', JSON.stringify(selected))
    await run(`Array.from(document.querySelectorAll('[data-selection-menu] button')).find(b => b.textContent.includes('코치 카드')).click()`)
    await wait(`document.body.textContent.includes('크립토필리아')`, 'card shown')
    await pause(300)
    console.log('marks after create:', await marks())
    // Close the card: the dotted underline stays.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await wait(`!document.querySelector('[role="dialog"][aria-label^="코치 카드"]')`, 'card closes')
    move(20, 820)
    await pause(300)
    assert.equal(await marks(), 1, 'the selection keeps its dotted underline')
    assert.equal(await markInTarget(), true, 'the underline is where the reader selected, not at the first match')
    // Hovering the underline opens the card again.
    const again = await phraseCenter()
    move(again.x - 3, again.y)
    move(again.x, again.y)
    await wait(`document.body.textContent.includes('크립토필리아')`, 'card reopens on hover')
    // Reopen the book: the card comes back from the database.
    await openBook()
    await wait(`(() => { const d = ${frameDoc}; const h = d?.defaultView.CSS.highlights.get('md-reader-coach'); return h && h.size === 1 })()`, 'mark after reopen')
    assert.equal(await markInTarget(), true, 'after reopening, the underline is still at the selected place')
    // The coach tab lists it under "내가 요청한 카드".
    await run(`Array.from(document.querySelectorAll('[role="tab"]')).find(b => b.textContent.trim() === '코치').click()`)
    await wait(`document.body.textContent.includes('내가 요청한 카드 1장')`, 'coach tab lists the card')
    const back = await phraseCenter()
    move(back.x - 3, back.y)
    move(back.x, back.y)
    await wait(`document.body.textContent.includes('크립토필리아')`, 'card after reopen')
    console.log('PASS: selection card keeps its underline, reopens on hover and survives reopening the book.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    console.error('debug', await run(`(() => { const d = ${frameDoc}; const h = d.defaultView.CSS.highlights.get('md-reader-coach'); const rs = h ? [...h].flatMap(r => [...r.getClientRects()].map(c => [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height), r.toString()])) : []; const f = d.defaultView.frameElement.getBoundingClientRect(); return JSON.stringify({ rs, frame: [f.x, f.y, f.width, f.height], frames: document.querySelectorAll('iframe').length }) })()`).catch(String))
    fs.writeFileSync(path.resolve('.tmp/coach-selection-card-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
