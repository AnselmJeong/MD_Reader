// After npm run build:
// node tests/build-smoke.mjs tests/epub-3d-math.smoke.ts .tmp/epub-3d-math.cjs
// node_modules/.bin/electron .tmp/epub-3d-math.cjs [book.epub] [--first-page=N]
// Opens a book with MathML formulas and a framed note. In 2D the book's dark-mode styles must
// follow the reader theme; in 3D formulas are laid out as formulas (no raw TeX in the page text),
// drawn into the page, and the note sits on a panel.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-3d-math-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const given = process.argv.slice(2).find((arg) => arg.endsWith('.epub'))
// Optional: --first-page=N draws six pages starting at page index N.
const firstPage = Number(process.argv.find((arg) => arg.startsWith('--first-page='))?.split('=')[1] ?? 0) || 0
const file = given ? path.resolve(given) : path.join(fixture, 'math.epub')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Math</title></head><body>${body}</body></html>`
const math = (inner: string, tex: string, display = 'inline') => `<math display="${display}" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>${inner}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
const pxy = '<mi>p</mi><mo stretchy="false">(</mo><mi>x</mi><mo>∣</mo><mi>y</mi><mo stretchy="false">)</mo>'
const bayes = `${pxy}<mo>=</mo><mfrac><mrow><mi>p</mi><mo>(</mo><mi>y</mi><mo>∣</mo><mi>x</mi><mo>)</mo><mi>p</mi><mo>(</mo><mi>x</mi><mo>)</mo></mrow><mrow><mi>p</mi><mo>(</mo><mi>y</mi><mo>)</mo></mrow></mfrac>`
const chapter = `<h1>베이즈 정리</h1>
<p>두 변수의 결합확률분포인 ${math(pxy, 'p(x \\mid y)')}와 같습니다.</p>
<div class="equation"><p>식 (1.2)</p><p>${math(bayes, 'p(x \\mid y) = \\frac{p(y \\mid x)p(x)}{p(y)}', 'block')}</p></div>
<div class="math-explain"><p><strong>수식 해설 — 식 (1.2): 숨은 상태 ${math('<mi>x</mi>', 'x')}에 대한 베이즈 정리</strong></p>
<ul><li><strong>한눈에 보기</strong>: 사후 확률분포 ${math(pxy, 'p(x \\mid y)')}를 구하는 공식입니다.</li>
<li><strong>기호 풀이</strong>:<ul><li>${math(pxy, 'p(x \\mid y)')}: <strong>사후 분포</strong> — 갱신된 신념.</li><li>${math('<mi>p</mi><mo>(</mo><mi>y</mi><mo>)</mo>', 'p(y)')}: <strong>모델 증거</strong>.</li></ul></li></ul></div>
<table><tr><th>기호</th><th>뜻</th></tr><tr><td>${math(pxy, 'p(x \\mid y)')}</td><td>사후 분포</td></tr></table>
<p>여기서 조건부 확률의 정의를 적용해 분자를 다시 써 봅니다.</p>`

app.whenReady().then(async () => {
  if (!given) {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('OEBPS/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">math-3d-test</dc:identifier><dc:title>Math 3D test</dc:title><dc:language>ko</dc:language></metadata><manifest><item id="css" href="book.css" media-type="text/css"/><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml" properties="mathml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`)
    zip.file('OEBPS/nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="Text/chapter1.xhtml">베이즈 정리</a></li></ol></nav>'))
    // Like many generated books: a light design plus a dark one for dark systems.
    zip.file('OEBPS/book.css', `.math-explain, .equation { background: #f3f1ea; padding: 0.8em 1em; border-left: 4px solid #7a86c2; }
a { color: #3b4a9a; }
@media (prefers-color-scheme: dark) { .math-explain, .equation { background: #1c1e2b; } .math-explain { color: #e8e8f0; } a { color: #dfe3ff; } }`)
    zip.file('OEBPS/Text/chapter1.xhtml', xhtml(chapter).replace('<head>', '<head><link rel="stylesheet" type="text/css" href="../book.css"/>'))
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  }
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1400, height: 950, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string, label = code) => {
    for (let i = 0; i < 300; i++) {
      if (await run(code)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Timed out: ' + label)
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shot = async (name: string) => fs.writeFileSync(path.resolve(`.tmp/${name}.png`), (await win.webContents.capturePage()).toPNG())
  try {
    await win.loadFile(path.resolve('out/renderer/index.html')).catch(() => undefined)
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!document.querySelector('iframe')`, 'chapter rendered')
    await pause(1200)
    if (await run(`document.body.textContent.includes('이 책, 어떻게 도와 드릴까요?')`)) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      await pause(400)
    }
    await shot('math-2d')
    if (!given) {
      // The book's own dark styles follow the reader's theme, not the system's.
      const boxBackground = () => run(`(() => { const d = Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).find(d => d?.querySelector('.math-explain')); return d ? d.defaultView.getComputedStyle(d.querySelector('.math-explain')).backgroundColor : null })()`)
      assert.equal(await boxBackground(), 'rgb(243, 241, 234)', 'light reader theme shows the book in its light design')
      await run(`window.api.settings.set('theme', 'dark')`)
      await pause(400)
      assert.equal(await boxBackground(), 'rgb(28, 30, 43)', 'dark reader theme shows the book in its dark design')
      await run(`window.api.settings.set('theme', 'light')`)
      await pause(400)
      assert.equal(await boxBackground(), 'rgb(243, 241, 234)', 'back to the light design')
    }
    await run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '3D').click()`)
    await wait(`!!document.querySelector('canvas')`, '3D canvas')
    const started = Date.now()
    await wait(`!!window.__mdReader3dAdapter`, '3D layout')
    console.log(`3D layout ready after ${Date.now() - started} ms`)
    await pause(2500)
    await shot('math-3d')
    const state = await run(`(async () => {
      const adapter = window.__mdReader3dAdapter
      const stats = adapter.getLayoutStats()
      const pageImages = []
      let inked = 0
      for (let i = ${firstPage}; i < Math.min(stats.pages, ${firstPage} + 6); i++) {
        const canvas = document.createElement('canvas')
        await adapter.renderPage(i, canvas, 1280, 1820, 'light')
        // toDataURL throws if a formula image tainted the canvas (it could then not be a texture).
        pageImages.push(canvas.toDataURL('image/png'))
      }
      return { ...stats, pageImages }
    })()`)
    fs.writeFileSync(path.resolve('.tmp/math-3d-text.txt'), state.printedText)
    for (const [index, url] of (state.pageImages as string[]).entries()) {
      fs.writeFileSync(path.resolve(`.tmp/math-3d-page-${index}.png`), Buffer.from(url.split(',')[1], 'base64'))
    }
    console.log(JSON.stringify({ pages: state.pages, mathRuns: state.mathRuns, boxes: state.boxes }))
    assert.ok(!/\\(mid|frac|mathcal|theta|text|hat)\b/.test(state.printedText), 'raw TeX is not printed')
    if (!given) {
      assert.ok(state.mathRuns >= 7, `formulas laid out as boxes: ${state.mathRuns}`)
      assert.equal(state.boxes, 2, `panels for the equation block and the note: ${state.boxes}`)
    }
    console.log('epub 3D math smoke passed')
    app.exit(0)
  } catch (error) {
    console.error(error)
    await shot('math-3d-failure').catch(() => undefined)
    app.exit(1)
  }
})
