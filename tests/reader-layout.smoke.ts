// Run twice with .tmp/layout-test-profile: write then read, exercising the real main entrypoint.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fitWindowBounds } from '../src/main/window-state-service'
import { restoreReaderLayout, defaultReaderLayout } from '../src/shared/reader-layout'

const profile = path.resolve('.tmp/layout-test-profile')
const phase = process.argv[2] || 'write'
if (phase === 'write') fs.rmSync(profile, { recursive: true, force: true })
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[path.resolve('.tmp/commentary-epub2-export.epub')] })
const area = {x:0,y:25,width:1280,height:775}
assert.deepEqual(fitWindowBounds({x:9000,y:-9000,width:2000,height:1200},[area],area),area)
assert.deepEqual(restoreReaderLayout({chatWidth:Infinity,showChat:'yes',epubSpreadMode:'bad'}),defaultReaderLayout)
assert.equal(restoreReaderLayout({chatWidth:2000}).chatWidth,800)
assert.equal(restoreReaderLayout({chatWidth:1}).chatWidth,300)
let testing = false
app.on('browser-window-created',(_e,win) => {
  if (testing) return
  testing = true
  win.webContents.once('did-finish-load', () => void test(win))
})
async function test(win: BrowserWindow) {
  const run = (code:string) => win.webContents.executeJavaScript(code)
  const wait = async (code:string) => {for(let i=0;i<150;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out '+code)}
  const layout = () => run(`JSON.parse(localStorage.getItem('md-reader-layout')).state`)
  try {
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    if (phase === 'write') {
      win.setBounds({x:100,y:100,width:1200,height:820})
      await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
      await wait(`!!document.querySelector('.epub-render-surface iframe')`)
      await run(`const s=document.querySelector('[role="separator"][aria-label="AI 패널 너비"]');s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));document.dispatchEvent(new MouseEvent('mousemove',{clientX:window.innerWidth-480,bubbles:true}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));`)
      await wait(`JSON.parse(localStorage.getItem('md-reader-layout')).state.chatWidth===480`)
      await run(`document.querySelector('[aria-label="목차 열기"]').click();document.querySelector('[title="집중 모드 (F)"]').click();document.querySelector('button[title="Toggle Chat (⌘/)"]').click();Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='1p').click()`)
      const expected = {chatWidth:480,showChat:false,showToC:true,focusMode:true,epubSpreadMode:'none'}
      await wait(`JSON.parse(localStorage.getItem('md-reader-layout')).state.epubSpreadMode==='none'`)
      assert.deepEqual(await layout(),expected)
      // Dialog and search state must never be persisted.
      assert.deepEqual(Object.keys(await layout()).sort(),Object.keys(expected).sort())
      await win.webContents.session.flushStorageData()
      const bounds = win.getNormalBounds()
      win.close()
      const saved = JSON.parse(fs.readFileSync(path.join(profile,'md-reader-window.json'),'utf8'))
      assert.deepEqual(saved.bounds,bounds)
      fs.writeFileSync(path.join(profile,'expected.json'),JSON.stringify({bounds,layout:expected}))
      console.log('PASS write: actual window geometry, divider drag, mode/TOC/focus/pane persisted on close',bounds)
    } else {
      const expected = JSON.parse(fs.readFileSync(path.join(profile,'expected.json'),'utf8'))
      assert.deepEqual(win.getNormalBounds(),expected.bounds)
      assert.deepEqual(await layout(),expected.layout)
      assert.equal(await run(`!!document.querySelector('[role="separator"][aria-label="AI 패널 너비"]')`),false)
      await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
      await wait(`!!document.querySelector('.epub-render-surface iframe')`)
      assert.equal(await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='1p').getAttribute('aria-pressed')`),'true')
      win.close()
      console.log('PASS read: real main and renderer restore saved geometry/layout across separate Electron processes')
    }
    app.quit()
  } catch(error) { console.error(error);app.exit(1) }
}
require(path.resolve('out/main/index.js'))
