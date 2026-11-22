// After npm run build:
// node tests/build-smoke.mjs tests/coach-read-ahead.smoke.ts .tmp/coach-read-ahead.cjs
// node_modules/.bin/electron .tmp/coach-read-ahead.cjs   (takes about a minute: the coach waits 20 s twice)
// The coach prepares the chapter being read and the next three chapters, not the whole book.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { deckCalls } from './helpers/coach-model-mock'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-coach-ahead-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
fs.mkdirSync(path.resolve('.tmp'), { recursive: true })
const file = path.join(fixture, 'ahead.epub')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Ahead</title></head><body>${body}</body></html>`
const chapter = (n: number) => xhtml(`<h1>Chapter ${n}</h1>` + Array.from({ length: 16 }, (_, i) => `<p>MARK-${n}: paragraph ${i} about the slow work of naming barnacles, one specimen at a time, in the study at Down House.</p>`).join(''))
const CHAPTERS = [1, 2, 3, 4, 5, 6]

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  // A short figure file after chapter 1 is not counted as a chapter to read ahead.
  const spine = ['c1', 'fig', ...CHAPTERS.slice(1).map(n => `c${n}`)]
  zip.file('OEBPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">coach-ahead-test</dc:identifier><dc:title>Read ahead test</dc:title><dc:language>en</dc:language></metadata><manifest>${CHAPTERS.map(n => `<item id="c${n}" href="Text/chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="fig" href="Text/figure.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine.map(id => `<itemref idref="${id}"/>`).join('')}</spine></package>`)
  zip.file('OEBPS/nav.xhtml', xhtml(`<nav epub:type="toc"><ol>${CHAPTERS.map(n => `<li><a href="Text/chapter${n}.xhtml">Chapter ${n}</a></li>`).join('')}</ol></nav>`))
  for (const n of CHAPTERS) zip.file(`OEBPS/Text/chapter${n}.xhtml`, chapter(n))
  zip.file('OEBPS/Text/figure.xhtml', xhtml('<p>MARK-FIG: Figure 1. A barnacle.</p>'))
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1200, height: 850, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  win.webContents.on('console-message', (_event, _level, message) => { if (/Coach/.test(message)) console.log('[renderer]', message) })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const until = async (check: () => Promise<boolean> | boolean, label: string, ms = 60000) => {
    for (const start = Date.now(); Date.now() - start < ms;) {
      if (await check()) return
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('Timed out: ' + label)
  }
  const prepared = () => CHAPTERS.filter(n => deckCalls.some(prompt => prompt.includes(`MARK-${n}:`)))
  const frameHas = (mark: string) => run(`Array.from(document.querySelectorAll('iframe')).some(f => f.contentDocument?.body?.textContent.includes('${mark}'))`)
  try {
    await win.loadFile(path.resolve('out/renderer/index.html')).catch(() => undefined)
    await until(() => run(`!!document.querySelector('button[title="Open File (⌘O)"]')`), 'app')
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await until(() => frameHas('MARK-1:'), 'chapter 1 rendered')
    await until(() => run(`document.body.textContent.includes('이렇게 시작하기')`), 'intake')
    await run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('이렇게 시작하기')).click()`)
    win.focus()
    // Chapter 1 after the dwell, then chapters 2-4 in the background; never 5, 6 or the figure.
    await until(() => prepared().length >= 4, 'read ahead from chapter 1', 70000)
    await new Promise((r) => setTimeout(r, 1500))
    assert.deepEqual(prepared(), [1, 2, 3, 4], 'chapter 1 and the next three chapters')
    assert.ok(!deckCalls.some(prompt => prompt.includes('MARK-FIG')), 'the short figure file is not prepared ahead')
    // Move to chapter 2: its cards are already there (no new call for it), and the window slides to chapter 5.
    for (let i = 0; i < 12 && !(await frameHas('MARK-2:')); i++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await new Promise((r) => setTimeout(r, 700))
    }
    await until(() => frameHas('MARK-2:'), 'chapter 2 rendered', 10000)
    const before = deckCalls.length
    await until(() => prepared().includes(5), 'read ahead from chapter 2', 50000)
    await new Promise((r) => setTimeout(r, 1500))
    assert.deepEqual(prepared(), [1, 2, 3, 4, 5], 'the window slides by one chapter')
    assert.equal(deckCalls.length, before + 1, 'chapters already prepared are not prepared again')
    console.log('PASS: the coach prepares the current chapter and the next three, and slides the window as the reader moves on.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    console.error('prepared:', prepared(), 'calls:', deckCalls.length)
    await run(`Array.from(document.querySelectorAll('[role="tab"]')).find(b => b.textContent.trim() === '코치')?.click()`).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 500))
    console.error('coach tab:', await run(`document.querySelector('aside, [class*="chat"]')?.parentElement?.textContent?.slice(-900)`).catch(String))
    fs.writeFileSync(path.resolve('.tmp/coach-read-ahead-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
