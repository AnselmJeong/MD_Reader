// Build first, bundle with esbuild (platform=node, packages=external), then run with Electron.
// Isolated profile and mocked subscriptions: never changes the user's documents or credentials.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-design-'))
app.setPath('userData', fixture)
fs.writeFileSync(path.join(fixture, 'agent-memory-settings.json'), JSON.stringify({ enabled: false }))
const docs = ['Neural dynamics.md', 'The reading mind.qmd', 'Research notes.md'].map(name => path.join(fixture, name))
for (const doc of docs) fs.writeFileSync(doc, '# Neural dynamics\n\n' + 'A quiet space to follow an idea. Research begins with a question, and develops through careful reading.\n\n'.repeat(70))
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [docs[0]] })
globalThis.fetch = async input => {
  if (String(input).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test' }] })
  throw Error('No network calls expected in design smoke: ' + input)
}
app.whenReady().then(async () => {
  require('./helpers/subscription-mock').installSubscriptionMock()
  require('../src/main/ipc-handlers').registerIpcHandlers()
  for (const doc of [...docs].reverse()) await require('../src/main/file-service').addRecentFile(doc)
  const win = new BrowserWindow({ show: true, width: 1440, height: 960, webPreferences: { preload: path.resolve('out/preload/index.js'), sandbox: false } })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => { for (let i=0;i<100;i++) { if(await run(code)) return; await new Promise(r=>setTimeout(r,80)) } throw Error('Timed out: '+code) }
  const click = (selector:string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = (selector:string, value:string) => run(`(()=>{ const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  const snap = async (name:string) => { await run(`document.fonts.ready`); await new Promise(r=>setTimeout(r,300)); fs.writeFileSync(path.resolve('.tmp/design-'+name+'.png'), (await win.webContents.capturePage()).toPNG()) }
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`document.querySelectorAll('.recent-document').length===3 && !!document.querySelector('textarea:not(:disabled)')`)
    await snap('home')
    await fill('[aria-label="최근 문서 검색"]', 'reading')
    await wait(`document.querySelectorAll('.recent-document').length===1`)
    await fill('[aria-label="최근 문서 검색"]', 'missing')
    await wait(`document.body.textContent.includes('검색 결과가 없습니다')`)
    await fill('[aria-label="최근 문서 검색"]', '')
    await click('.recent-document')
    await wait(`!!document.querySelector('.reader-page-canvas') && !document.querySelector('.home-workspace')`)
    await run(`document.fonts.ready`)
    await run(`window.savedReader=document.querySelector('.reader-page-canvas'); window.savedReader.style.scrollBehavior='auto'; window.savedReader.scrollTop=350`)
    await wait(`window.savedReader.scrollTop===350`)
    await fill('textarea[aria-label="메시지 입력"]','읽던 문단에 관한 질문')
    await click('[aria-label="홈"]')
    await wait(`!!document.querySelector('.home-workspace')`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true}))`)
    assert.equal(await run(`document.querySelector('[title="집중 모드 (F)"]').getAttribute('aria-pressed')`),'false','hidden reader ignores shortcuts')
    assert.equal(await run(`window.savedReader.clientHeight>0 && window.savedReader.scrollTop===350`),true)
    await click('.recent-document')
    await wait(`!document.querySelector('.home-workspace')`)
    assert.equal(await run(`document.querySelector('.reader-page-canvas')===window.savedReader && window.savedReader.scrollTop===350`),true)
    assert.equal(await run(`document.querySelector('textarea[aria-label="메시지 입력"]').value`),'읽던 문단에 관한 질문')
    await click('[aria-label="홈"]')
    await click('button[title="Open File (⌘O)"]')
    await wait(`!document.querySelector('.home-workspace')`)
    await snap('reader')
    await click('button[title="Settings"]')
    await wait(`!!document.querySelector('[role="dialog"]')`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true}))`)
    assert.equal(await run(`document.querySelector('[title="집중 모드 (F)"]').getAttribute('aria-pressed')`),'false','modal blocks reader shortcuts')
    for (const [theme,label] of [['dark','다크'],['sepia','세피아'],['light','라이트']]) {
      await run(`Array.from(document.querySelectorAll('[data-slot="toggle-group-item"]')).find(e=>e.textContent===${JSON.stringify(label)}).click()`)
      await wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`)
      assert.equal(await run(`window.api.settings.get().then(s=>s.theme)`),theme)
      await snap('settings-'+theme)
    }
    for(const id of ['appearance','ai','search','memory']) {
      await run(`document.querySelector('#settings-${id}').scrollIntoView({block:'start'})`)
      assert.equal(await run(`document.querySelector('#settings-${id}').getBoundingClientRect().top>=document.querySelector('.settings-content').getBoundingClientRect().top-1`),true)
    }
    await click('[data-slot="dialog-close"]')
    await wait(`!document.querySelector('[role="dialog"]')`)
    assert.equal(await run(`document.activeElement.title`),'Settings')
    await click('[aria-label="홈"]')
    for(const width of [1200,1000,900]) {
      win.setSize(width,820)
      await new Promise(r=>setTimeout(r,300))
      assert.equal(await run(`document.querySelector('.home-workspace').scrollWidth<=document.querySelector('.home-workspace').clientWidth+1`),true,'home overflow at '+width)
      assert.equal(await run(`document.querySelector('.composer-tools').scrollWidth<=document.querySelector('.composer-tools').clientWidth+1`),true,'composer overflow at '+width)
    }
    await snap('compact')
    console.log('PASS: recent search/empty state, reopen active document, live reader instance/scroll/draft retained through home, file dialog return, three persistent themes, all settings sections, dialog focus return, 900–1440px layout.')
    win.destroy();app.exit(0)
  } catch(error) { console.error(error);await snap('failure');win.destroy();app.exit(1) }
}).finally(()=>fs.rmSync(fixture,{recursive:true,force:true}))
