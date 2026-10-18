// npm run build
// node_modules/.bin/esbuild tests/epub-image-viewer.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/epub-image-viewer.cjs
// node_modules/.bin/electron .tmp/epub-image-viewer.cjs
import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-image-viewer-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const file = path.join(fixture, 'figures.epub')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
const opened: string[] = []
shell.openExternal = async url => { opened.push(url) }
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Figures</title></head><body>${body}</body></html>`

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('EPUB/package.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">epub-images-test</dc:identifier><dc:title>Figure enlargement</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" properties="svg"/><item id="figure" href="figure.svg" media-type="image/svg+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>`)
  zip.file('EPUB/nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="chapter.xhtml">Figures</a></li></ol></nav>'))
  zip.file('EPUB/figure.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1000" viewBox="0 0 2400 1000"><rect width="2400" height="1000" fill="white"/><g fill="none" stroke="#244a61" stroke-width="5"><rect x="100" y="150" width="950" height="700"/><rect x="1350" y="150" width="950" height="700"/><path d="M100 500H1050M575 150V850M1350 500H2300M1825 150V850"/><circle cx="575" cy="500" r="150"/><circle cx="1825" cy="500" r="250"/></g><g font-family="sans-serif" font-size="64" fill="#142531"><text x="100" y="100">(a) Stable node</text><text x="1350" y="100">(b) Limit cycle</text></g></svg>')
  zip.file('EPUB/chapter.xhtml', xhtml('<h1>Inspect a figure</h1><figure><img id="figure" src="figure.svg" alt="Two phase portraits" /><figcaption>Figure 1. Phase portraits</figcaption></figure><p id="following">The source paragraph and its reading position must remain unchanged.</p><p><a href="figure.svg"><img id="linked-figure" src="figure.svg" alt="Linked figure" width="60"/></a> <a href="https://example.org/paper"><img id="article-link" src="figure.svg" alt="Read article" width="60"/></a></p><svg id="svg-cover" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 2400 1000" width="100" height="40"><image width="2400" height="1000" xlink:href="figure.svg"/></svg>'))
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, title: 'Image viewer QA', width: 1250, height: 900, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => {
    for (let i = 0; i < 160; i++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Timed out: ' + code)
  }
  const source = `Array.from(document.querySelectorAll('.epub-render-surface iframe')).map(f=>f.contentDocument).find(d=>d?.querySelector('#figure'))`
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const close = async () => { await click('[aria-label="그림 닫기"]'); await wait(`!document.querySelector('.epub-image-dialog')`) }
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await click('button[title="Open File (⌘O)"]')
    await wait(`(${source})?.querySelector('#figure')?.getAttribute('aria-haspopup') === 'dialog'`)
    // Intrinsic 2400px image inside a figure with the browser's 40px margins.
    // epub.js's old pixel max-width exceeded this containing block by 80px.
    const measure = async () => run(`(()=>{const d=${source};const img=d.querySelector('#figure'),p=img.parentElement,s=d.defaultView.getComputedStyle(d.body),r=img.getBoundingClientRect();return {image:r.width,parent:p.getBoundingClientRect().width,column:parseFloat(s.columnWidth),height:r.height,available:d.documentElement.clientHeight-40,fragments:img.getClientRects().length}})()`)
    for (const [mode,width] of [['1p',1250],['1p',1000],['2p',1400],['2p',1100],['1p',1250]] as const) {
      await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='${mode}').click()`)
      win.setSize(width,900)
      await wait(`(${source})?.querySelector('#figure')?.getAttribute('aria-haspopup') === 'dialog'`)
      await new Promise(resolve => setTimeout(resolve,700))
      const box = await measure()
      assert.ok(box.image <= box.parent + 1, JSON.stringify({mode,width,...box}))
      assert.ok(box.image <= box.column + 1, JSON.stringify({mode,width,...box}))
      assert.ok(box.height <= box.available + 1, JSON.stringify(box))
      assert.equal(box.fragments,1)
      console.log('Page fit', mode, width, box)
    }
    await run(fs.readFileSync(path.resolve('node_modules/epubjs/dist/epub.js'), 'utf8') + ';void 0')
    await run(`window.sourceDoc=${source};window.sourceCfi=new ePub.CFI(sourceDoc.querySelector('#following'),'/6/2').toString();window.sourceText=sourceDoc.body.textContent;window.sourceRect=sourceDoc.querySelector('#figure').getBoundingClientRect().toJSON();sourceDoc.querySelector('#figure').click()`)
    await wait(`document.querySelector('.epub-image-dialog[open] img')?.naturalWidth === 2400`)
    await wait(`(()=>{const img=document.querySelector('.epub-image-dialog img');const stage=document.querySelector('.epub-image-viewport');return img.clientWidth>500 && img.clientWidth<=stage.clientWidth && img.clientHeight<=stage.clientHeight})()`)
    const fit = await run(`(()=>{const img=document.querySelector('.epub-image-dialog img');const stage=document.querySelector('.epub-image-viewport');return {width:img.clientWidth,height:img.clientHeight,stageWidth:stage.clientWidth,stageHeight:stage.clientHeight}})()`)
    assert.ok(fit.width <= fit.stageWidth && fit.height <= fit.stageHeight, JSON.stringify(fit))
    assert.equal(await run(`document.activeElement.getAttribute('aria-label')`), '그림 닫기')
    await click('.epub-image-controls button:last-child')
    await wait(`document.querySelector('.epub-image-dialog img').clientWidth === 2400`)
    await click('[aria-label="확대"]')
    await wait(`document.querySelector('.epub-image-dialog img').clientWidth === 3000`)
    assert.ok(await run(`(()=>{const s=document.querySelector('.epub-image-viewport');s.scrollLeft=300;return s.scrollLeft>0})()`))
    await click('.epub-image-controls button[aria-pressed]')
    await wait(`document.querySelector('.epub-image-dialog img').clientWidth < 2400`)
    fs.writeFileSync(path.resolve('.tmp/epub-image-viewer-fit.png'), (await win.webContents.capturePage()).toPNG())
    // Modal focus and reader shortcuts cannot move the underlying book.
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true}))`)
    assert.equal(await run(`!!document.querySelector('.epub-reading-stage.focus-mode, [data-search-panel="true"]')`), false)
    await run(`document.querySelector('.epub-image-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`)
    await wait(`!document.querySelector('.epub-image-dialog')`)
    assert.equal(await run(`sourceDoc.activeElement.id`), 'figure')
    assert.equal(await run(`new ePub.CFI(sourceDoc.querySelector('#following'),'/6/2').toString()===sourceCfi && sourceDoc.body.textContent===sourceText`), true)
    assert.equal(await run(`Math.abs(sourceDoc.querySelector('#figure').getBoundingClientRect().x-sourceRect.x)<1`), true)
    for (const key of ['Enter', ' ']) {
      await run(`sourceDoc.querySelector('#figure').dispatchEvent(new sourceDoc.defaultView.KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`)
      await wait(`!!document.querySelector('.epub-image-dialog[open]')`)
      await close()
    }
    await run(`sourceDoc.querySelector('#linked-figure').click()`)
    await wait(`!!document.querySelector('.epub-image-dialog[open]')`)
    await close()
    await run(`sourceDoc.querySelector('#article-link').click()`)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.deepEqual(opened, ['https://example.org/paper'])
    assert.equal(await run(`!!document.querySelector('.epub-image-dialog')`), false)
    await run(`sourceDoc.querySelector('#svg-cover image').dispatchEvent(new sourceDoc.defaultView.MouseEvent('click',{bubbles:true,cancelable:true}))`)
    await wait(`document.querySelector('.epub-image-dialog img')?.naturalWidth === 2400`)
    await close()
    // A failed book image remains dismissible instead of showing an empty overlay.
    await run(`sourceDoc.querySelector('#figure').src='data:image/png;base64,broken'`)
    await wait(`sourceDoc.querySelector('#figure').complete && !sourceDoc.querySelector('#figure').naturalWidth`)
    await run(`sourceDoc.querySelector('#figure').click()`)
    await wait(`!!document.querySelector('.epub-image-dialog [role="alert"]')`)
    await close()
    console.log('PASS: EPUB img/SVG image sources, fit/original/zoom/scroll, keyboard/cancel/focus return, stable CFI and reading position, linked figures, external links, error dismissal.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    fs.writeFileSync(path.resolve('.tmp/epub-image-viewer-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
