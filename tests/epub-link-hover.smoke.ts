// After npm run build:
// npx esbuild tests/epub-link-hover.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/epub-link-hover.cjs
// node_modules/.bin/electron .tmp/epub-link-hover.cjs
import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-epub-links-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const file = path.join(fixture, 'links.epub')
const opened: string[] = []
let failOpen = false
shell.openExternal = async (url) => {
  if (failOpen) throw new Error('Test browser failure')
  opened.push(url)
}
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Links</title></head><body>${body}</body></html>`

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('EPUB/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">epub-links-test</dc:identifier><dc:title>EPUB links test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="refs" href="references.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/><itemref idref="refs"/></spine></package>`)
  zip.file('EPUB/nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li><li><a href="references.xhtml">References</a></li></ol></nav>'))
  zip.file('EPUB/chapter.xhtml', xhtml(`<h1>Chapter</h1><p>Reference <a id="cross" href="references.xhtml#ref-paper">[1]</a> and <a id="local" href="#note">[2]</a>.</p><p><a id="external" title="External paper title" href="https://example.org/paper">External paper</a></p><aside id="note" epub:type="footnote">A note without an external URL.</aside>`))
  zip.file('EPUB/references.xhtml', xhtml('<h1>References</h1><div id="ref-paper" class="csl-entry">Author. <a href="https://doi.org/10.1234/epub-test">The EPUB paper title</a>. 2024.</div>'))
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1200, height: 850, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => {
    for (let i = 0; i < 150; i++) {
      if (await run(code)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Timed out: ' + code)
  }
  const find = (selector: string, framed = false) => framed
    ? `Array.from(document.querySelectorAll('iframe')).map(f=>f.contentDocument?.querySelector(${JSON.stringify(selector)})).find(Boolean)`
    : `document.querySelector(${JSON.stringify(selector)})`
  const hover = async (selector: string, framed = false) => {
    const rect = await run(`(() => { const el = ${find(selector, framed)}; const r=el.getBoundingClientRect(); const f=el.ownerDocument.defaultView.frameElement?.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2+(f?.x||0)),y:Math.round(r.y+r.height/2+(f?.y||0))} })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...rect })
  }
  const click = async (selector: string, framed = false) => run(`(${find(selector, framed)}).click()`)
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await click('button[title="Open File (⌘O)"]')
    await wait(`!!(${find('#cross', true)})`)
    win.focus()
    await new Promise((r) => setTimeout(r, 500))
    await hover('#cross', true)
    await wait(`document.body.textContent.includes('The EPUB paper title')`)
    const doi = 'a[href="https://doi.org/10.1234/epub-test"]'
    await hover(doi)
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(await run(`!!document.querySelector('${doi}')`), true)
    await click(doi)
    assert.deepEqual(opened, ['https://doi.org/10.1234/epub-test'])
    // Launch errors remain actionable in the shared tooltip.
    failOpen = true
    await click(doi)
    await wait(`!!document.querySelector('[role="alert"]')`)
    failOpen = false
    await hover('#local', true)
    await wait(`document.body.textContent.includes('A note without an external URL.')`)
    assert.equal(await run(`!!document.querySelector('.fixed.z-50 a[href]')`), false)
    // Dismiss the note preview before targeting the link on the line beneath it.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 150 })
    await wait(`!document.querySelector('.fixed.z-50')`)
    await hover('#external', true)
    await wait(`document.body.textContent.includes('External paper title')`)
    await click('a[href="https://example.org/paper"]')
    assert.equal(opened.at(-1), 'https://example.org/paper')
    await click('#external', true)
    assert.equal(opened.filter((url) => url === 'https://example.org/paper').length, 2)
    // Iframe keyboard focus produces a parent-window preview as well.
    await run(`(${find('#cross', true)}).focus()`)
    await wait(`document.body.textContent.includes('The EPUB paper title')`)
    fs.writeFileSync(path.resolve('.tmp/epub-link-hover.png'), (await win.webContents.capturePage()).toPNG())
    // Citation clicks still navigate within the book and clear the old preview.
    await click('#cross', true)
    await wait(`!!(${find('#ref-paper', true)})`)
    await wait(`!document.querySelector('${doi}')`)
    console.log('PASS: cross-chapter and local reference previews, iframe pointer/focus, tooltip transfer, default-browser IPC, error handling, external links, internal navigation.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    fs.writeFileSync(path.resolve('.tmp/epub-link-hover-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
