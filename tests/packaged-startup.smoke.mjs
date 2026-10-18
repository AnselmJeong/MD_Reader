// Run with Node 22+: node tests/packaged-startup.smoke.mjs '/path/to/MD Reader.app'
// Launch the actual packaged entrypoint, not a separately bundled test harness.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const bundle = path.resolve(process.argv[2] || 'dist/mac-arm64/MD Reader.app')
await fs.access(path.join(bundle, 'Contents/Resources/app.asar'))
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'md-reader-packaged-'))
const epubFixture = process.argv[3] ? path.resolve(process.argv[3]) : null
if (epubFixture) await fs.writeFile(path.join(profile, 'md-reader-files.json'), JSON.stringify({ recentFiles: [epubFixture], bibliographyPaths: {} }))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
env.PATH = "/usr/bin:/bin"
const child = spawn(path.join(bundle, 'Contents/MacOS/MD Reader'), [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0'
], { env, stdio: ['ignore', 'pipe', 'pipe'] })
const closed = once(child, 'close')
let log = ''
let launchError
child.on('error', error => { launchError = error })
child.stdout.on('data', data => { log += data })
child.stderr.on('data', data => { log += data })
let socket
let nextId = 0
const pending = new Map()
function command(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timed out: ${method}`))
    }, 10000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
try {
  let page
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (launchError) throw launchError
    assert.equal(child.exitCode, null, `App exited early: ${log}`)
    assert.doesNotMatch(log, /ERR_MODULE_NOT_FOUND|Uncaught Exception|Error launching app/)
    const port = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]
    if (port) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
      page = pages.find(item => item.type === 'page' && item.url.startsWith('file:'))
      if (page) break
    }
    await delay(200)
  }
  assert.ok(page, `Packaged renderer did not load: ${log}`)
  assert.ok(page.url.includes('/app.asar/out/renderer/'), page.url)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  let ready = false
  while (Date.now() < deadline) {
    const result = await command('Runtime.evaluate', {
      expression: 'Boolean(document.querySelector("#root")?.children.length && window.api?.commentary)',
      returnByValue: true
    })
    if (result.result.value) { ready = true; break }
    await delay(200)
  }
  assert.ok(ready, 'Renderer or preload API did not initialize')
  const controls = await command('Runtime.evaluate', {
    expression: `(() => {
      const search = document.querySelector('button[aria-label="웹 검색"]')
      const thinking = document.querySelector('select[aria-label="Thinking 수준"]')
      return { search: search?.getAttribute('aria-pressed'), thinking: thinking?.value,
        levels: Array.from(thinking?.options || []).map(option => option.value) }
    })()`,
    returnByValue: true
  })
  assert.deepEqual(controls.result.value, {
    search: 'false', thinking: 'none', levels: ['none', 'low', 'medium', 'high']
  })
  const result = await command('Runtime.evaluate', {
    expression: 'window.api.commentary.list("0".repeat(64))',
    awaitPromise: true,
    returnByValue: true
  })
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
  assert.deepEqual(result.result.value, { notes: [], assets: [] })
  await fs.access(path.join(profile, 'commentary.sqlite'))
  const subscriptions = await command('Runtime.evaluate', {
    expression: 'window.api.subscriptions.status()', awaitPromise: true, returnByValue: true
  })
  assert.equal(subscriptions.exceptionDetails, undefined)
  for (const provider of ['codex', 'claude']) assert.equal(subscriptions.result.value[provider].state, 'signedOut')
  const models = await command('Runtime.evaluate', {
    expression: 'window.api.ai.listModels()', awaitPromise: true, returnByValue: true
  })
  assert.ok(models.result.value.some(model => model.name === 'codex:default'))
  assert.ok(models.result.value.some(model => model.name === 'claude:sonnet'))
  await command('Runtime.evaluate', { expression: `document.querySelector('button[title="Settings"]').click()` })
  await delay(1000)
  const settings = await command('Runtime.evaluate', {
    expression: `(() => { const headings = Array.from(document.querySelectorAll('p')); headings.find(p => p.textContent.startsWith('GPT와 Claude'))?.scrollIntoView({block: 'start'}); return {text: document.body.textContent, legacy: typeof window.api.ollama} })()`, returnByValue: true
  })
  assert.match(settings.result.value.text, /ChatGPT subscription/)
  assert.match(settings.result.value.text, /Claude subscription/)
  assert.doesNotMatch(settings.result.value.text, /Ollama/)
  assert.equal(settings.result.value.legacy, 'undefined')
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  await fs.mkdir('.tmp', { recursive: true })
  await fs.writeFile('.tmp/subscription-settings.png', Buffer.from(screenshot.data, 'base64'))
  await command('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Done').click()` })
  console.log('PASS: packaged subscription UI, restricted PATH CLI discovery, signed-out accounts and model choices')
  if (epubFixture) {
    const run = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const wait = async expression => {
      for (let i=0;i<100;i++) { if (await run(expression)) return; await delay(100) }
      throw new Error('Packaged HTML check timed out: ' + expression)
    }
    const fileName = JSON.stringify(path.basename(epubFixture))
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${fileName}))`)
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${fileName})).click()`)
    const frame = `Array.from(document.querySelectorAll('.epub-render-surface iframe')).flatMap(f=>Array.from(f.contentDocument?.querySelectorAll('md-reader-notes')||[])).map(h=>h.shadowRoot?.querySelector('.commentary-html-frame')).find(Boolean)`
    await wait(`!!(${frame})`)
    assert.equal(await run(`(${frame}).getAttribute('sandbox')`), '')
    assert.ok(await run(`(${frame}).srcdoc.includes('<svg')`))
    assert.ok(await run(`typeof window.api.commentary.importHtml === 'function' && typeof window.api.commentary.permanentlyDelete === 'function'`))
    const doc = await run(`window.api.file.read(${JSON.stringify(epubFixture)})`)
    const snapshot = await run(`window.api.commentary.list(${JSON.stringify(doc.documentHash)})`)
    assert.ok(snapshot.notes[0].html.content.includes('<svg'))
    await run(`Array.from(document.querySelectorAll('.epub-render-surface iframe')).flatMap(f=>Array.from(f.contentDocument?.querySelectorAll('md-reader-notes')||[])).flatMap(h=>Array.from(h.shadowRoot?.querySelectorAll('button')||[])).find(b=>b.textContent==='HTML 크게 보기 ↗').click()`)
    await wait(`!!document.querySelector('.commentary-html-dialog[open] iframe')`)
    await delay(600)
    const screenshot = await command('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.resolve('.tmp/commentary-html-packaged.png'), Buffer.from(screenshot.data, 'base64'))
    console.log('PASS: actual packaged app imports HTML EPUB, restores SVG attachment, exposes HTML/delete IPC and opens expanded viewer.')
  }
  assert.doesNotMatch(log, /ERR_MODULE_NOT_FOUND|Uncaught Exception/)
  console.log(`PASS: packaged startup, sidebar Search Off / Thinking None controls, renderer, preload IPC and native commentary database: ${bundle}`)
} finally {
  socket?.close()
  for (const request of pending.values()) clearTimeout(request.timeout)
  child.kill('SIGTERM')
  const forceKill = setTimeout(() => child.kill('SIGKILL'), 3000)
  await closed
  clearTimeout(forceKill)
  await fs.rm(profile, { recursive: true, force: true })
}
