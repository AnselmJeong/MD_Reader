// npm run build
// npx esbuild tests/commentary.smoke.ts --bundle --platform=node --external:electron --external:better-sqlite3 --outfile=.tmp/commentary-smoke.cjs
// node_modules/.bin/electron .tmp/commentary-smoke.cjs
// Set MD_READER_COMMENTARY_PLACEMENT_ONLY=1 to run the focused placement regression.
import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-commentary-'))
app.setPath('userData', path.join(fixture, 'profile'))
fs.mkdirSync(path.join(fixture, 'profile'))
const file = path.join(fixture, 'source.epub')
const exported = path.join(fixture, 'annotated.epub')
let chosenFile = file
let imagePath = ''
dialog.showOpenDialog = async (options: any) => ({ canceled: false, filePaths: [options.title?.includes('그림') ? imagePath : chosenFile] })
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
const xhtml = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ko"><head><title>Commentary test</title><style>body{font-family:serif}table{width:100%;border-collapse:collapse}td,th{padding:0}td{vertical-align:middle}</style></head><body>${body}</body></html>`

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('EPUB/package.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">commentary-test</dc:identifier><dc:title>주석으로 자라는 책</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">2026-09-12T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" properties="mathml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/><itemref idref="second"/></spine></package>`)
  zip.file('EPUB/nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="chapter.xhtml">첫 번째 장</a></li></ol></nav>'))
  zip.file('EPUB/chapter.xhtml', xhtml(`<h1>주석으로 자라는 책</h1><p id="anchor">다섯 개념은 각각 서로 다른 수학적 조건을 요구하며, 그 조건들은 서로 독립적이다.</p><p id="following">이 문단의 위치는 주석을 추가해도 유지되어야 한다.</p><table id="wide"><caption>표 1.1. 다섯 개념과 그 수학적 요구 조건</caption><thead><tr><th>개념</th><th>수학적 대상</th><th>성립 조건</th><th>조건이 깨질 때</th></tr></thead><tbody><tr><td>끌개 (attractor)</td><td><math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>ℬ</mi><mo>(</mo><mi>A</mi><mo>)</mo><mo>=</mo><mo>{</mo><msub><mi>x</mi><mn>0</mn></msub><mo>:</mo><msub><mi>φ</mi><mi>t</mi></msub><mo>(</mo><msub><mi>x</mi><mn>0</mn></msub><mo>)</mo><mo>→</mo><mi>A</mi><mo>}</mo></mrow></math></td><td>컴팩트 불변집합 + 근방 흡인성</td><td>수렴이 아니라 통과일 뿐 (유령 끌개, 8장)</td></tr><tr><td>유역 (basin)</td><td>불변집합의 위상 변화</td><td>안정 끌개의 복수 공존 (다중안정성)</td><td>유일 끌개면 유역 개념이 공허해짐</td></tr></tbody></table><p>표 다음 본문도 읽을 수 있어야 한다. <a id="next-chapter" href="second.xhtml">다음 장</a></p>`))
  zip.file('EPUB/second.xhtml', xhtml('<h1>두 번째 장</h1><p id="second-anchor">다른 장에서도 주석을 이어 갑니다.</p><p><a id="back-chapter" href="chapter.xhtml">첫 장으로</a></p>'))
  const original = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(file, original)
  const hash = createHash('sha256').update(original).digest('hex')
  const img = nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 180), { width: 64, height: 64 })
  imagePath = path.join(fixture, 'figure.png'); fs.writeFileSync(imagePath, img.toPNG())
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  const { saveChatSession } = require('../src/main/chat-session-service')
  const seeded = saveChatSession({ contextMeta: { documentKind: 'epub', documentId: `sha256:${hash}`, fileName:'source.epub', contextTitle:'첫 번째 장', chapterHref:'chapter.xhtml', contentHash:hash }, title:'Test discussion', titleStatus:'generated', model:'test', messages:[{ id:'user-test',role:'user',content:'추가 설명',timestamp:Date.now() }, { id:'answer-test',role:'assistant',content:'AI에서 채택한 설명. $a^2+b^2=c^2$',timestamp:Date.now() }], processMemory:false })
  const win = new BrowserWindow({ show: true, width: 1440, height: 960, webPreferences: {
    preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
    // EPUB.js schedules layout and navigation on animation frames, including while the user is in another app.
    backgroundThrottling: false
  } })
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('renderer:', message) })
  const run = async (code: string) => { try { return await win.webContents.executeJavaScript(code) } catch (error) { console.error('Failed browser script:',code.slice(0,600)); throw error } }
  const wait = async (code: string) => {
    for (let i = 0; i < 200; i++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 50)) }
    throw new Error('Timed out: ' + code)
  }
  const source = `Array.from(document.querySelectorAll('.epub-render-surface iframe')).map(f=>f.contentDocument).find(d=>d?.querySelector('#anchor'))`
  const deepSetup = `window.deep=(root,selector)=>{if(!root)return [];let result=Array.from(root.querySelectorAll(selector));for(const el of root.querySelectorAll('*'))if(el.shadowRoot)result.push(...window.deep(el.shadowRoot,selector));return result};`
  const click = async (label: string, root = 'document') => {
    await run(`Array.from(${root}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  }
  const fill = async (text: string) => run(`(()=>{const el=document.querySelector('.commentary-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!(${source})`)
    await run(deepSetup + ';window.addEventListener("error",e=>console.error(e.error?.stack));void 0')
    // Load the exact installed CFI implementation solely into the isolated test page.
    await run(fs.readFileSync(path.resolve('node_modules/epubjs/dist/epub.js'), 'utf8') + ';void 0')
    await run(`(()=>{const doc=${source}; const range=doc.createRange();range.selectNodeContents(doc.querySelector('#following').firstChild);doc.querySelector('#following').removeAttribute('id');window.originalCfi=new ePub.CFI(range,'/6/2').toString();range.startContainer.parentElement.id='following';window.originalText=doc.body.textContent})()`)
    const table = await run(`(()=>{const t=(${source}).querySelector('table');const s=getComputedStyle(t);return {client:t.clientWidth,scroll:t.scrollWidth,top:s.borderTopWidth,bottom:s.borderBottomWidth,header:getComputedStyle(t.querySelector('th')).borderBottomWidth,cells:Array.from(t.querySelectorAll('td')).map(e=>e.getBoundingClientRect().width)}})()`)
    assert.ok(table.scroll > table.client, JSON.stringify(table)); assert.equal(table.top,'2px'); assert.equal(table.bottom,'2px');assert.equal(table.header,'1px');assert.ok(table.cells.every((n:number)=>n>=100))
    fs.writeFileSync(path.resolve('.tmp/commentary-table-2p.png'), (await win.webContents.capturePage()).toPNG())
    await click('표 크게 보기 ↗')
    await wait(`!!document.querySelector('.epub-table-dialog[open] iframe')`)
    await new Promise(r=>setTimeout(r,500))
    const expanded = await run(`(()=>{const f=document.querySelector('.epub-table-dialog iframe');const t=f.contentDocument.querySelector('table');return {width:t.getBoundingClientRect().width,headers:t.querySelectorAll('th').length,math:t.querySelectorAll('math').length,script:f.sandbox.contains('allow-scripts')}})()`)
    assert.ok(expanded.width>1000);assert.equal(expanded.headers,4);assert.equal(expanded.math,1);assert.equal(expanded.script,false)
    fs.writeFileSync(path.resolve('.tmp/commentary-table-expanded.png'),(await win.webContents.capturePage()).toPNG())
    await click('닫기', `document.querySelector('.epub-table-dialog')`)
    await click('＋ 주석')
    await wait(`!!document.querySelector('.commentary-position-picker')`)
    assert.equal(await run(`document.querySelector('.commentary-position-picker footer button').disabled`),true)
    await run(`(()=>{const doc=${source};doc.querySelector('#anchor').dispatchEvent(new doc.defaultView.MouseEvent('mousemove',{bubbles:true}))})()`)
    assert.equal(await run(`(${source}).querySelector('#anchor').getAttribute('data-mdr-commentary-position')`),'hover')
    await run(`(${source}).querySelector('#anchor').click()`)
    await wait(`document.querySelector('.commentary-position-preview blockquote')?.textContent.includes('다섯 개념')`)
    assert.equal(await run(`!!document.querySelector('.commentary-editor[open]')`),false)
    assert.equal(await run(`(${source}).querySelector('#anchor').getAttribute('data-mdr-commentary-position')`),'selected')
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    fs.writeFileSync(path.resolve('.tmp/commentary-position-picker.png'),(await win.webContents.capturePage()).toPNG())
    await click('이 문단 뒤에 넣기')
    await wait(`!!document.querySelector('.commentary-editor[open] textarea')`)
    const content = '첫 번째 주석.\n\n$$\nE = \\frac{1}{2}mv^2\n$$\n\n| 항목 | 설명 |\n| --- | --- |\n| 에너지 | 수식과 함께 보존 |\n\n<script>window.bad=true</script>'
    await fill(content)
    // Choosing another candidate and pressing Escape preserves the unsaved content and original anchor.
    await click('본문에서 위치 선택')
    await wait(`!!document.querySelector('.commentary-position-picker')`)
    await run(`(${source}).querySelector('#following').click()`)
    await wait(`document.querySelector('.commentary-position-preview blockquote')?.textContent.includes('이 문단의 위치')`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(`!!document.querySelector('.commentary-editor[open] textarea')`)
    assert.equal(await run(`document.querySelector('.commentary-editor textarea').value`),content)
    assert.ok(await run(`document.querySelector('.commentary-anchor').textContent.includes('다섯 개념')`))
    assert.equal(await run(`(${source}).querySelectorAll('[data-mdr-commentary-position]').length`),0)
    assert.equal(await run(`(${source}).body.textContent===window.originalText`),true)
    await click('그림 추가', `document.querySelector('.commentary-editor')`)
    await wait(`document.querySelector('.commentary-editor textarea').value.includes('mdr-asset:')`)
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}),'[data-note-id]').length===1`)
    await wait(`document.querySelector('.commentary-status [role="status"]')?.textContent.includes('주석이 저장되었습니다')`)
    await wait(`!document.querySelector('.commentary-status [role="status"]')`)
    assert.equal(await run(`(${source}).body.textContent===window.originalText`), true)
    assert.equal(await run(`new ePub.CFI(window.originalCfi).toRange(${source}).toString()`),'이 문단의 위치는 주석을 추가해도 유지되어야 한다.')
    assert.equal(await run(`window.deep((${source}),'math').length>=2`),true)
    assert.equal(await run(`window.deep((${source}),'script').some(e=>e.textContent.includes('window.bad'))`),false)
    await run(`window.deep((${source}),'button').find(b=>b.textContent.includes('답글 추가')).click()`)
    await fill('첫 번째 답글: 원 주석을 확장합니다.')
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}),'[data-note-id]').length===2`)
    // Move the saved root using the keyboard-accessible paragraph list. Replies follow only on save.
    await run(`window.deep((${source}),'button').find(b=>b.textContent==='수정').click()`)
    await wait(`!!document.querySelector('.commentary-editor[open]')`)
    await click('본문에서 위치 선택')
    await wait(`!!document.querySelector('.commentary-position-picker select')`)
    await run(`(()=>{const el=document.querySelector('.commentary-position-picker select');el.value=Array.from(el.options).find(o=>o.textContent.includes('이 문단의 위치')).value;el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('.commentary-position-preview blockquote')?.textContent.includes('이 문단의 위치')`)
    assert.equal(await run(`(${source}).querySelector('md-reader-notes')?.parentElement.id`),'anchor')
    await click('이 문단 뒤에 넣기')
    await wait(`!!document.querySelector('.commentary-editor[open]')`)
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}).querySelector('#following'),'[data-note-id]').length===2`)
    const moved = await run(`window.api.commentary.list(${JSON.stringify(hash)})`)
    assert.ok(moved.notes.every((note:any)=>note.anchor.elementId==='following'))
    assert.equal(await run(`(${source}).body.textContent===window.originalText`),true)
    assert.equal(await run(`new ePub.CFI(window.originalCfi).toRange(${source}).toString()`),'이 문단의 위치는 주석을 추가해도 유지되어야 한다.')
    // Return the root to its starting paragraph so the remaining export and reading checks use the original fixture.
    await run(`window.deep((${source}),'button').find(b=>b.textContent==='수정').click()`)
    await wait(`!!document.querySelector('.commentary-editor[open]')`)
    await click('본문에서 위치 선택')
    await wait(`!!document.querySelector('.commentary-position-picker')`)
    await run(`(${source}).querySelector('#anchor').click()`)
    await click('이 문단 뒤에 넣기')
    await wait(`!!document.querySelector('.commentary-editor[open]')`)
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}).querySelector('#anchor'),'[data-note-id]').length===2`)
    if (process.env.MD_READER_COMMENTARY_PLACEMENT_ONLY === '1') {
      assert.equal(await run(`(${source}).querySelectorAll('[data-mdr-commentary-position]').length`),0)
      assert.deepEqual(fs.readFileSync(file),original)
      console.log('PASS: new-note placement, paragraph highlight/preview/confirmation, Escape preserves draft and original anchor, paragraph-list navigation, saved root and reply relocation, source text/CFI and source EPUB unchanged.')
      win.destroy();app.exit(0);return
    }
    await run(`window.deep((${source}),'button').find(b=>b.textContent==='수정').click()`)
    await wait(`!!document.querySelector('.commentary-editor[open]')`)
    await run(`(()=>{const e=document.querySelector('.commentary-editor textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,e.value+'\\n\\n수정된 설명.');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}),'.commentary-prose').some(e=>e.textContent.includes('수정된 설명'))`)
    await run(`window.deep((${source}),'button').find(b=>b.textContent==='삭제').click()`)
    await wait(`window.deep((${source}),'.deleted').length===1`)
    assert.equal(await run(`window.deep((${source}),'.commentary-prose').some(e=>e.textContent.includes('첫 번째 답글'))`),true)
    await run(`window.deep((${source}),'button').find(b=>b.textContent==='복원').click()`)
    await wait(`window.deep((${source}),'.deleted').length===0`)
    await click('주석 읽기')
    await wait(`!!(${source})?.querySelector('md-reader-notes')?.shadowRoot?.querySelector('[data-note-id]')`)
    fs.writeFileSync(path.resolve('.tmp/commentary-reader.png'), (await win.webContents.capturePage()).toPNG())
    await wait(`!!document.querySelector('select[title="Saved sessions for this reading context"] option[value="${seeded.sessionId}"]')`)
    await run(`(()=>{const el=document.querySelector('select[title="Saved sessions for this reading context"]');el.value=${JSON.stringify(seeded.sessionId)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Show answer')`)
    await click('Show answer')
    await click('본문에 주석으로 추가')
    await wait(`!!document.querySelector('.commentary-editor[open] textarea')`)
    assert.ok(await run(`document.querySelector('.commentary-editor textarea').value.includes('AI에서 채택한 설명')`))
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}),'[data-note-id]').length===3`)
    await click('주석 포함 EPUB 저장')
    await wait(`document.querySelector('.commentary-status')?.textContent.includes('저장 완료')`)
    await wait(`!document.querySelector('.commentary-status [role="status"]')`)
    const exportedZip = await JSZip.loadAsync(fs.readFileSync(exported))
    const metadata = JSON.parse(await exportedZip.file('MDReader-Commentary/commentary.json')!.async('string'))
    assert.equal(metadata.notes.length,3); assert.equal(metadata.assets.length,1); assert.equal(metadata.sourceHash,hash)
    assert.deepEqual(await exportedZip.file('MDReader-Commentary/original.epub')!.async('nodebuffer'),original)
    const chapter = await exportedZip.file('EPUB/chapter.xhtml')!.async('string')
    assert.ok(chapter.includes('mdr-commentary')); assert.ok(chapter.includes('MathML')); assert.ok(chapter.includes('images/')); assert.ok(!chapter.includes('<script>'))
    assert.deepEqual(fs.readFileSync(file),original)
    const beforeReopenFrame = await run(`(${source}).defaultView.frameElement.id`)
    chosenFile=exported
    await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`)
    await wait(`!!(${source})?.querySelector('md-reader-notes')?.shadowRoot?.querySelector('[data-note-id]') && (${source}).defaultView.frameElement.id !== ${JSON.stringify(beforeReopenFrame)}`)
    await wait(`window.deep((${source}),'[data-note-id]').length===3`)
    assert.equal(await run(`window.deep((${source}),'[data-note-id]').length`),3)
    const notes = await run(`window.api.commentary.list(${JSON.stringify(hash)})`)
    assert.equal(notes.notes.length,3); assert.equal(notes.notes.find((n:any)=>n.origin)?.origin.messageId,'answer-test')
    // Verify an older portable snapshot cannot resurrect a locally deleted annotation.
    const root=notes.notes.find((n:any)=>!n.parentId)
    await run(`window.api.commentary.setDeleted(${JSON.stringify(hash)},${JSON.stringify(root.id)},true)`)
    await run(`window.api.file.read(${JSON.stringify(exported)})`)
    assert.ok((await run(`window.api.commentary.list(${JSON.stringify(hash)})`)).notes.find((n:any)=>n.id===root.id).deletedAt)
    // Load the portable file into a completely empty commentary database.
    const { closeCommentaryDb, listCommentary } = require('../src/main/commentary-service')
    closeCommentaryDb()
    const freshProfile=path.join(fixture,'fresh-profile');fs.mkdirSync(freshProfile);app.setPath('userData',freshProfile)
    await run(`window.api.file.read(${JSON.stringify(exported)})`)
    const fresh=listCommentary(hash);assert.equal(fresh.notes.length,3);assert.equal(fresh.assets.length,1)
    assert.equal(fresh.notes.filter((n:any)=>n.parentId).length,1)
    // Navigate to another spine item and return without stale commentary hosts.
    await wait(`typeof (${source})?.querySelector('#next-chapter')?.onclick === 'function'`)
    await run(`(${source}).querySelector('#next-chapter').click()`)
    await wait(`Array.from(document.querySelectorAll('.epub-render-surface iframe')).some(f=>f.contentDocument?.querySelector('#second-anchor'))`)
    await run(`Array.from(document.querySelectorAll('.epub-render-surface iframe')).map(f=>f.contentDocument?.querySelector('#back-chapter')).find(Boolean).click()`)
    await wait(`!!(${source})?.querySelector('md-reader-notes')?.shadowRoot?.querySelector('[data-note-id]')`)
    await wait(`window.deep((${source}),'[data-note-id]').length===3`)
    assert.equal(await run(`window.deep((${source}),'[data-note-id]').length`),3)
    console.log('PASS: paragraph hover/selection/confirmation, Escape preserves draft/anchor, paragraph list relocation with replies; 2p table widths and rules; source text/CFI unchanged; add math/table/image, reply, edit, delete/restore; scroll mode; portable EPUB save/reopen and no duplication; newer local deletion wins; original bytes unchanged.')
    console.log('Artifacts:',fixture)
    win.destroy(); app.exit(0)
  } catch(error) {
    console.error(error)
    console.log('Reader state:',await run(`({dialogs:Array.from(document.querySelectorAll('dialog[open]')).map(d=>d.className),frames:Array.from(document.querySelectorAll('.epub-render-surface iframe')).map(f=>({text:f.contentDocument?.body.textContent?.slice(0,100),hosts:Array.from(f.contentDocument?.querySelectorAll('md-reader-notes')||[]).map(h=>({parent:h.parentElement.id,notes:h.shadowRoot?.querySelectorAll('[data-note-id]').length}))})),status:document.querySelector('.commentary-status')?.textContent})`))
    fs.writeFileSync(path.resolve('.tmp/commentary-failure.png'),(await win.webContents.capturePage()).toPNG())
    console.log('Fixture:',fixture)
    win.destroy();app.exit(1)
  }
})
