// After npm run build:
// npx esbuild tests/quarto-equations.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/quarto-equations-smoke.cjs
// node_modules/.bin/electron .tmp/quarto-equations-smoke.cjs [optional-source.qmd]
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const originalPath = path.resolve(process.argv[2] ?? 'examples/quarto/equations.qmd')
const original = fs.readFileSync(originalPath, 'utf8')
const ids = [...original.matchAll(/^\$\$ \{#(eq-[^}]+)\}$/gm)].map(match => match[1])
assert.ok(ids.length >= 2)
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-equations-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(app.getPath('userData'))
const doc = path.join(fixture, path.basename(originalPath))
fs.writeFileSync(doc, original)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [doc] })

app.whenReady().then(async () => {
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: {
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
  let failed = false
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!document.getElementById(${JSON.stringify(ids.at(-1))})`)
    assert.equal(await run(`document.querySelectorAll('.katex-error').length`), 0)
    assert.equal(await run(`document.querySelectorAll('.quarto-equation > .katex-display').length`), ids.length)
    for (const [index, id] of ids.entries()) {
      assert.equal(await run(`document.getElementById(${JSON.stringify(id)}).querySelector('.quarto-equation-number').textContent`), `(${index + 1})`)
    }
    assert.equal(await run(`document.querySelector('#eq-noise-corr + p strong').textContent`), '신호 상관')
    assert.equal(await run(`document.querySelector('#eq-noise-corr + p em').textContent`), '평균')
    assert.ok(await run(`!!document.querySelector('#eq-noise-corr + p .katex')`))
    const initialUrl = win.webContents.getURL()
    const lastId = ids.at(-1)!
    await run(`document.querySelector('a[href="#${lastId}"]').click()`)
    await wait(`document.querySelector('.reader-page-canvas').scrollTop > 100`)
    assert.equal(win.webContents.getURL(), initialUrl)
    await new Promise(resolve => setTimeout(resolve, 700))
    await run(`document.querySelector('#sec-noise-corr-def').scrollIntoView({behavior:'instant'})`)
    await new Promise(resolve => setTimeout(resolve, 600))
    await run(`document.fonts.ready`)
    const equationSizes = await run(`Array.from(document.querySelectorAll('.quarto-equation > .katex-display')).map(el => ({ id: el.parentElement.id, height: el.clientHeight, scrollHeight: el.scrollHeight }))`)
    assert.ok(equationSizes.every((size: { height: number; scrollHeight: number }) => size.scrollHeight <= size.height + 1), JSON.stringify(equationSizes))
    fs.mkdirSync('.tmp', { recursive: true })
    fs.writeFileSync('.tmp/quarto-equations.png', (await win.webContents.capturePage()).toPNG())
    assert.equal(fs.readFileSync(originalPath, 'utf8'), original)
    assert.equal(fs.readFileSync(doc, 'utf8'), original)
    console.log(`PASS: ${ids.length} labelled display equations, numbering, Korean prose, inline math, cross-reference navigation, unchanged source.`)
  } catch (error) {
    failed = true
    console.error(error)
  } finally {
    win.destroy()
    fs.rmSync(fixture, { recursive: true, force: true })
    app.exit(failed ? 1 : 0)
  }
})
