// After npm run build:
// npx esbuild tests/quarto.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/quarto-smoke.cjs
// node_modules/.bin/electron .tmp/quarto-smoke.cjs
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { extractQuartoHeadings } from '../src/renderer/src/components/DocumentReader/utils/headings'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-qmd-ui-'))
fs.mkdirSync(path.join(fixture, 'profile'))
app.setPath('userData', path.join(fixture, 'profile'))
const doc = path.join(fixture, 'paper.QMD')
const source = fs.readFileSync('examples/quarto/reading.qmd', 'utf8').replace('format: html', 'bibliography: refs/paper.bib\nformat: html') + '\n\n[@smith2024]\n'
fs.writeFileSync(doc, source)
fs.copyFileSync('examples/quarto/figure.svg', path.join(fixture, 'figure.svg'))
fs.mkdirSync(path.join(fixture, 'refs'))
fs.writeFileSync(path.join(fixture, 'refs/paper.bib'), '@article{smith2024, title={Declared bibliography}, year={2024}}')
let filters: Electron.FileFilter[] = []
dialog.showOpenDialog = async (...args: unknown[]) => {
  const options = args.at(-1) as Electron.OpenDialogOptions
  filters = options.filters ?? []
  return { canceled: false, filePaths: [doc] }
}
app.whenReady().then(async () => {
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  const { readDocumentFile } = require('../src/main/file-service')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1200, height: 900, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false
  } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => {
    for (let i = 0; i < 100; i++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${code}`)
  }
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!document.querySelector('#sec-intro')`)
    assert.ok(filters.some(filter => filter.extensions.includes('qmd')))
    assert.equal(await run(`document.querySelector('.reader-title').textContent`), 'Quarto 문서 읽기')
    assert.equal(await run(`document.querySelector('.meta-authors').textContent`), '홍길동')
    assert.equal(await run(`document.querySelectorAll('.metadata-card h1').length`), 0)
    await wait(`document.querySelector('#fig-trend img')?.naturalWidth > 0`)
    assert.equal(await run(`document.querySelector('#fig-trend img').alt`), '시간이 지날수록 증가하는 선 그래프')
    assert.equal(await run(`document.querySelector('#fig-trend figcaption').textContent`), 'Figure 1: 시간에 따른 변화')
    assert.equal(await run(`document.querySelector('#tbl-results figcaption').textContent`), 'Table 1: 조건별 측정값')
    assert.equal(await run(`document.querySelector('[data-cite-key="smith2024"]').textContent`), '[1]')
    assert.equal(await run(`document.querySelectorAll('[data-cite-key^="fig-"], [data-cite-key^="sec-"], [data-cite-key^="tbl-"]').length`), 0)
    assert.ok((await readDocumentFile(doc)).bibContent.includes('Declared bibliography'))
    const { readBibliography } = require('../src/main/bibliography-service')
    const extraBib = path.join(fixture, 'refs', 'extra.bib')
    fs.writeFileSync(extraBib, '@book{extra, title={Second bibliography}}')
    fs.writeFileSync(doc, source.replace('bibliography: refs/paper.bib', 'bibliography: [refs/paper.bib, refs/extra.bib]'))
    const multiple = await readBibliography(doc)
    assert.ok(multiple.bibContent.includes('Declared bibliography') && multiple.bibContent.includes('Second bibliography'))
    assert.equal((await readBibliography(doc, extraBib)).bibContent, fs.readFileSync(extraBib, 'utf8'))
    fs.unlinkSync(extraBib)
    assert.ok((await readBibliography(doc)).bibError)
    fs.writeFileSync(doc, source)
    // The same parser supplies the TOC and the rendered anchors.
    for (const heading of extractQuartoHeadings(source)) {
      assert.equal(await run(`document.getElementById(${JSON.stringify(heading.id)})?.textContent`), heading.text)
    }
    assert.equal(await run(`document.querySelectorAll('.quarto-unresolved-ref').length`), 1)
    const initialUrl = win.webContents.getURL()
    await run(`document.querySelector('a[href="#sec-results"]').click()`)
    await wait(`document.querySelector('.reader-page-canvas').scrollTop > 100`)
    assert.equal(win.webContents.getURL(), initialUrl)
    // Source saving must preserve YAML, attributes and executable cell options.
    const loaded = await readDocumentFile(doc)
    assert.equal(loaded.content, source)
    await run(`window.api.file.save(${JSON.stringify(doc)}, ${JSON.stringify(source)})`)
    assert.equal(fs.readFileSync(doc, 'utf8'), source)
    await run(`document.querySelector('.reader-page-canvas').scrollTo({top:0,behavior:'instant'})`)
    await new Promise(resolve => setTimeout(resolve, 400))
    fs.mkdirSync('.tmp', { recursive: true })
    fs.writeFileSync('.tmp/quarto-smoke.png', (await win.webContents.capturePage()).toPNG())
    await run(`document.querySelector('#sec-results').scrollIntoView({behavior:'instant'})`)
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.writeFileSync('.tmp/quarto-figures.png', (await win.webContents.capturePage()).toPNG())
    console.log('PASS: QMD picker, metadata, image decoding, figure/table captions, cross-reference scrolling, TOC IDs, YAML bibliography, unchanged source round trip.')
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    fs.mkdirSync('.tmp', { recursive: true })
    fs.writeFileSync('.tmp/quarto-failure.png', (await win.webContents.capturePage()).toPNG())
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(1)
  }
})
