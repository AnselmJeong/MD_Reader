// Build the app, bundle this file with esbuild (platform=node, packages=external), run with Electron.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-scroll-'))
app.setPath('userData', fixture)

delete process.env.TINYFISH_API_KEY
fs.writeFileSync(path.join(fixture, 'agent-memory-settings.json'), JSON.stringify({ enabled: false }))
const doc = path.join(fixture, 'paper.md')
fs.writeFileSync(doc, '# Scroll fixture\n\n' + 'Document reading position must stay fixed.\n\n'.repeat(80))
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [doc] })
let stream: ReadableStreamDefaultController<Uint8Array>
const encoder = new TextEncoder()
const token = (content: string) => stream.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'))
globalThis.fetch = async (input, init) => {
  if (String(input).endsWith('/models')) return Response.json({ data: [{ id: 'test-model' }] })
  if (String(input).endsWith('/chat/completions')) {
    if (!JSON.parse(String(init?.body)).stream) return Response.json({ choices: [{ message: { content: 'Scroll fixture' } }] })
    return new Response(new ReadableStream({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } })
  }
  throw Error('Unexpected network request')
}

app.whenReady().then(async () => {
 require('./helpers/subscription-mock').installSubscriptionMock()
  require('../src/main/ipc-handlers').registerIpcHandlers()
  const win = new BrowserWindow({ show: true, width: 1200, height: 800, webPreferences: { preload: path.resolve('out/preload/index.js'), sandbox: false } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const settle = () => new Promise(r => setTimeout(r, 150))
  const wait = async (code: string) => {
    for (let i = 0; i < 100; i++) { if (await run(code)) return; await settle() }
    throw Error('Timed out: ' + code)
  }
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!document.querySelector('.reader-markdown-content') && !!document.querySelector('.ai-sidebar')`)
    await run('document.fonts.ready')
    await settle()
    await run(`window.chatScroller = document.querySelector('[aria-label="Conversation messages"]') || document.querySelector('.ai-sidebar > .flex-1'); window.readerScroller=document.querySelector('.reader-page-canvas'); window.readerScroller.style.scrollBehavior='auto'; window.readerScroller.scrollTop=200`)
    await settle()
    const documentTop = await run('window.readerScroller.scrollTop')
    await run(`document.querySelector('.ai-sidebar button[title="Summarize"]').click()`)
    await wait(`!!document.querySelector('button[title="Stop response (Esc)"]')`)
    for (let i = 0; i < 100 && !stream!; i++) await settle()
    token('First paragraph.\n\n' + 'A long explanation of $w_{ij}=w_{ji}$ and neural dynamics.\n\n'.repeat(30))
    await wait(`document.querySelectorAll('.chat-message-content .katex').length >= 30`)
    await settle()
    const geometry = await run(`(()=>{const s=window.chatScroller;return {top:s.scrollTop,height:s.clientHeight,total:s.scrollHeight,ancestors:(()=>{const a=[];for(let p=s.parentElement;p;p=p.parentElement)a.push({name:p.tagName,class:p.className,top:p.scrollTop});return a})()}})()`)
    console.log('Scroll geometry:', JSON.stringify(geometry))
    assert.ok(geometry.height > 200, 'Conversation viewport must remain usable')
    assert.ok(geometry.ancestors.every((a: {top:number}) => a.top === 0), 'Chat scrolling must not move any outer container')
    assert.equal(await run('window.readerScroller.scrollTop'), documentTop, 'Document reading position must stay fixed')
    assert.ok(geometry.total - geometry.height - geometry.top < 3, 'Rendered math must follow to the bottom')
    await run(`window.chatScroller.scrollTop -= 300; window.chatScroller.dispatchEvent(new Event('scroll'))`)
    const readingTop = await run('window.chatScroller.scrollTop')
    token('\n\nMORE ANSWER\n\n' + 'Additional reasoning.\n\n'.repeat(12))
    await wait(`document.querySelector('.ai-sidebar').textContent.includes('MORE ANSWER')`)
    await settle()
    assert.ok(Math.abs(await run('window.chatScroller.scrollTop') - readingTop) < 3, 'Reading earlier text must not be interrupted by tokens')
    await run(`document.querySelector('button[title="Jump to latest answer"]').click()`)
    await settle()
    assert.ok(await run('window.chatScroller.scrollHeight-window.chatScroller.clientHeight-window.chatScroller.scrollTop < 3'))
    win.setSize(1000, 650)
    token('\n\nRESIZED ANSWER\n\n$$\nE = -\\sum_{ij} w_{ij}s_i s_j\n$$')
    await wait(`document.querySelector('.ai-sidebar').textContent.includes('RESIZED ANSWER')`)
    stream.enqueue(encoder.encode('data: [DONE]\n\n')); stream.close()
    await wait(`!document.querySelector('button[title="Stop response (Esc)"]')`)
    await settle()
    assert.ok(await run('window.chatScroller.scrollHeight-window.chatScroller.clientHeight-window.chatScroller.scrollTop < 3'), 'Resize and final rendering must keep latest visible')
    assert.ok(await run(`(()=>{const s=window.chatScroller;for(let p=s.parentElement;p;p=p.parentElement)if(p.scrollTop)return false;const input=document.querySelector('.ai-sidebar textarea').getBoundingClientRect();return input.top>38 && input.bottom<innerHeight})()`), 'Header/input and outer layout must stay in the window')
    fs.writeFileSync(path.resolve('.tmp/chat-scroll.png'), (await win.webContents.capturePage()).toPNG())
    console.log('PASS: outer layout fixed, deferred math follows bottom, scroll-up preserved, latest button, resize and completion.')
    win.destroy(); fs.rmSync(fixture, { recursive: true, force: true }); app.exit(0)
  } catch (error) {
    console.error(error)
    fs.writeFileSync(path.resolve('.tmp/chat-scroll-failure.png'), (await win.webContents.capturePage()).toPNG())
    win.destroy(); fs.rmSync(fixture, { recursive: true, force: true }); app.exit(1)
  }
})
