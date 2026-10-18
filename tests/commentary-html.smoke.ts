// npm run build
// npx esbuild tests/commentary-html.smoke.ts --bundle --platform=node --external:electron --external:better-sqlite3 --outfile=.tmp/commentary-html.cjs
// node_modules/.bin/electron .tmp/commentary-html.cjs
import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { closeCommentaryDb, listCommentary, importCommentaryHtml, importCommentaryImage, saveCommentary, setCommentaryDeleted, commentaryDeletionPlan, permanentlyDeleteCommentary } from '../src/main/commentary-service'
import { readCommentaryEpub } from '../src/main/commentary-epub'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-html-'))
app.setPath('userData', fixture)
const sourcePath = path.join(fixture, 'source.epub')
const exported = path.join(fixture, 'annotated.epub')
let htmlPath = path.join(fixture, 'Claude answer.html')
let cancelImport = false
let confirmDelete = false
let confirmation: any
let win: BrowserWindow

dialog.showOpenDialog = async (options: any) => ({ canceled: cancelImport, filePaths: [options.title?.includes('HTML') ? htmlPath : sourcePath] })
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
dialog.showMessageBox = (async (_window: any, options: any) => { confirmation = options; return { response: confirmDelete ? 1 : 0, checkboxChecked: false } }) as any

app.whenReady().then(async () => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('EPUB/book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">html-test</dc:identifier><dc:title>HTML 주석 테스트</dc:title><dc:language>ko</dc:language><meta property="dcterms:modified">2026-09-12T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>')
  zip.file('EPUB/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>HTML 주석</title></head><body><h1>그림이 포함된 설명 보관</h1><p id="anchor">흥분성 집단과 억제성 집단의 상호작용을 살펴봅니다.</p><p id="following">원문은 주석을 추가해도 그대로 유지됩니다.</p></body></html>')
  const original = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(sourcePath, original)
  const documentId = createHash('sha256').update(original).digest('hex')
  const image = nativeImage.createFromBitmap(Buffer.alloc(24 * 24 * 4, 180), { width: 24, height: 24 }).toDataURL()
  const raw = `<!doctype html><html lang="ko"><head><title>두 집단의 상호작용</title><style>body{font-family:system-ui;line-height:1.8;padding:20px}h1{font-size:24px}svg{width:100%}.caption{color:#555}#remote{background:url(https://invalid.example.test/blocked.png)}</style><meta http-equiv="refresh" content="0;url=https://invalid.example.test/navigate"></head><body><h1>흥분과 억제의 균형</h1><p>설명과 그림을 하나의 HTML 주석으로 보관합니다.</p><svg id="figure" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 190"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#555"/></marker></defs><rect x="30" y="35" width="220" height="95" rx="14" fill="#fcebe5" stroke="#ce7555"/><text x="80" y="78" font-size="22" fill="#933b24">흥분성 집단 E(t)</text><rect x="440" y="35" width="220" height="95" rx="14" fill="#e4effc" stroke="#6398dc"/><text x="485" y="78" font-size="22" fill="#245c9b">억제성 집단 I(t)</text><path d="M255 65 H432 M435 105 H260" stroke="#555" marker-end="url(#arrow)"/></svg><p class="caption">Figure 1. 두 집단 사이의 연결</p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>E</mi><mo>+</mo><mi>I</mi></math><img id="embedded" src="${image}" alt="내장 이미지"><div id="remote">오프라인 보관</div><a href="file:///etc/passwd">차단된 링크</a><script>window.compromised=true;parent.compromised=true</script><img src="https://invalid.example.test/image.png" onerror="window.compromised=true"><iframe src="https://invalid.example.test/frame"></iframe></body></html>`
  fs.writeFileSync(htmlPath, raw)
  const { registerIpcHandlers } = require('../src/main/ipc-handlers')
  registerIpcHandlers()
  win = new BrowserWindow({ show: true, width: 1440, height: 960, webPreferences: { preload: path.resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } })
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.log('Renderer:',message)})
  const requests: string[] = []
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://invalid.example.test/*'] }, (details, callback) => { requests.push(details.url); callback({ cancel: true }) })
  const run = (code: string) => win.webContents.executeJavaScript(code)
  const wait = async (code: string) => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 50)) } throw new Error('Timed out: ' + code) }
  const source = `Array.from(document.querySelectorAll('.epub-render-surface iframe')).map(f=>f.contentDocument).find(d=>d?.querySelector('#anchor'))`
  const setup = `window.deep=(root,selector)=>{if(!root)return [];let result=Array.from(root.querySelectorAll(selector));for(const el of root.querySelectorAll('*'))if(el.shadowRoot)result.push(...window.deep(el.shadowRoot,selector));return result};`
  const click = (label: string, root = 'document') => run(`Array.from(${root}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  const noteClick = (label: string) => run(`window.deep((${source}),'button').find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`)
  const openBook = async () => { await win.loadFile(path.resolve('out/renderer/index.html')); await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`); await run(setup + ';void 0'); await run(`document.querySelector('button[title="Open File (⌘O)"]').click()`); await wait(`!!(${source})`); }
  try {
    await openBook()
    await click('주석 읽기')
    await wait(`!!(${source})`)
    const originalText = await run(`(${source}).body.textContent`)
    await run(`(${source}).querySelector('#anchor').click()`)
    await click('＋ 주석')
    await wait(`!!document.querySelector('.commentary-editor[open] textarea')`)
    cancelImport = true
    await click('HTML 추가', `document.querySelector('.commentary-editor')`)
    await wait(`!Array.from(document.querySelectorAll('.commentary-edit-tools button')).find(b=>b.textContent==='HTML 추가').disabled`)
    assert.equal(await run(`!!document.querySelector('.commentary-html-info')`), false)
    cancelImport = false
    await click('HTML 추가', `document.querySelector('.commentary-editor')`)
    await wait(`!!document.querySelector('.commentary-preview iframe')`)
    assert.equal(await run(`document.querySelector('.commentary-preview iframe').getAttribute('sandbox')`), '')
    await new Promise(r => setTimeout(r, 300))
    win.webContents.debugger.attach('1.3')
    let childSession = ''
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') childSession = params.sessionId })
    await win.webContents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    for (let i=0; !childSession && i<50; i++) await new Promise(r=>setTimeout(r,50))
    assert.ok(childSession, 'Isolated HTML frame is available to DevTools')
    const tree = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true }, childSession)
    const flatten = (node: any): any[] => [node, ...(node.children ?? []).flatMap(flatten), ...(node.contentDocument ? flatten(node.contentDocument) : []), ...(node.shadowRoots ?? []).flatMap(flatten)]
    const dom = flatten(tree.root)
    const figure = dom.find(node => node.nodeName === 'svg' && node.attributes?.includes('figure'))
    const embedded = dom.find(node => node.nodeName === 'IMG' && node.attributes?.includes('embedded'))
    assert.ok(figure); assert.ok(embedded)
    const svgBox = await win.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId: figure.nodeId }, childSession)
    const imageBox = await win.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId: embedded.nodeId }, childSession)
    assert.ok(svgBox.model.width > 300); assert.equal(imageBox.model.width, 24)
    assert.ok(dom.some(node => node.nodeName === 'math'))
    const safe = await run(`document.querySelector('.commentary-preview iframe').srcdoc`)
    assert.doesNotMatch(safe, /<script|<iframe|onerror=|http-equiv="refresh"|href="file:/)
    assert.equal(await run(`!!window.compromised`), false)
    assert.equal(await run(`document.querySelector('.commentary-preview iframe').contentDocument === null`), true)
    win.webContents.debugger.detach()
    assert.deepEqual(requests, [])
    fs.writeFileSync(path.resolve('.tmp/commentary-html-preview.png'), (await win.webContents.capturePage()).toPNG())
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`window.deep((${source}),'.commentary-html-frame').length===1`)
    let root = listCommentary(documentId).notes[0]
    assert.equal(root.markdown, ''); assert.equal(root.html?.content, raw)
    assert.equal(await run(`(${source}).body.textContent`), originalText)
    fs.unlinkSync(htmlPath)
    closeCommentaryDb()
    await openBook()
    await wait(`window.deep((${source}),'.commentary-html-frame').length===1`)
    assert.equal(listCommentary(documentId).notes[0].html?.content, raw)
    await noteClick('HTML 크게 보기 ↗')
    await wait(`!!document.querySelector('.commentary-html-dialog[open] iframe')`)
    await new Promise(r => setTimeout(r, 600))
    fs.writeFileSync(path.resolve('.tmp/commentary-html-expanded.png'), (await win.webContents.capturePage()).toPNG())
    await run(`document.querySelector('.commentary-html-dialog iframe').focus()`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(`!document.querySelector('.commentary-html-dialog[open]')`)
    await noteClick('주석을 스크롤로 읽기 ↗')
    await wait(`!!document.querySelector('.commentary-note-dialog[open] iframe')`)
    assert.equal(await run(`document.querySelector('.commentary-note-dialog').textContent.includes('원문은 주석을 추가해도')`),false)
    assert.equal(await run(`document.querySelectorAll('.commentary-note-dialog [data-reading-note-id]').length`),1)
    await new Promise(r=>setTimeout(r,400))
    fs.writeFileSync(path.resolve('.tmp/note-reader-083.png'), (await win.webContents.capturePage()).toPNG())
    await run(`document.querySelector('.commentary-note-dialog iframe').focus()`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
    await wait(`!document.querySelector('.commentary-note-dialog[open]')`)
    await noteClick('수정')
    await wait(`!!document.querySelector('.commentary-editor[open] textarea')`)
    await click('HTML 제거', `document.querySelector('.commentary-editor')`)
    assert.equal(await run(`Array.from(document.querySelectorAll('.commentary-editor button')).find(b=>b.textContent==='주석 저장').disabled`), true)
    fs.writeFileSync(htmlPath, raw.replace('흥분과 억제의 균형', '수정된 HTML 설명'))
    await run(`document.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))`)
    await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(raw.replace('흥분과 억제의 균형', '수정된 HTML 설명'))}],'dropped.html',{type:'text/html'}));document.querySelector('.commentary-editor').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))})()`)
    await wait(`!!document.querySelector('.commentary-preview iframe')`)
    assert.ok(await run(`document.querySelector('.commentary-html-help').textContent.includes('HTML 추가')`))
    // Whole-document paste is recognized as HTML, including its head/style.
    await click('HTML 제거', `document.querySelector('.commentary-editor')`)
    await click('편집', `document.querySelector('.commentary-editor')`)
    await run(`(()=>{const dt=new DataTransfer();dt.setData('text/plain',${JSON.stringify(raw.replace('흥분과 억제의 균형', '수정된 HTML 설명'))});document.querySelector('.commentary-editor textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`)
    await wait(`!!document.querySelector('.commentary-preview iframe')`)
    await click('주석 저장', `document.querySelector('.commentary-editor')`)
    await wait(`!document.querySelector('.commentary-editor[open]')`)
    root = listCommentary(documentId).notes[0]
    assert.ok(root.html?.content.includes('수정된 HTML 설명'))
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='주석 포함 EPUB 저장'&&!b.disabled)`)
    await click('주석 포함 EPUB 저장')
    await wait(`document.querySelector('.commentary-status')?.textContent.includes('저장 완료')`)
    const archive = await JSZip.loadAsync(fs.readFileSync(exported))
    const attachment = await archive.file(`MDReader-Commentary/html/${root.id}.xhtml`)!.async('string')
    new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(attachment, 'application/xhtml+xml')
    assert.ok(attachment.includes('<svg')); assert.ok(!attachment.includes('<script'))
    assert.ok((await archive.file('EPUB/chapter.xhtml')!.async('string')).includes('HTML 주석 열기'))
    assert.deepEqual(fs.readFileSync(sourcePath), original)
    const fresh = path.join(fixture, 'fresh'); fs.mkdirSync(fresh); closeCommentaryDb(); app.setPath('userData', fresh)
    await readCommentaryEpub(fs.readFileSync(exported))
    assert.equal(listCommentary(documentId).notes[0].html?.content, root.html?.content)
    const sharedPath = path.join(fixture, 'shared.png')
    const uniquePath = path.join(fixture, 'unique.png')
    fs.writeFileSync(sharedPath, nativeImage.createFromDataURL(image).toPNG())
    fs.writeFileSync(uniquePath, nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 90), { width: 16, height: 16 }).toPNG())
    const sharedAsset = await importCommentaryImage(documentId, sharedPath)
    const uniqueAsset = await importCommentaryImage(documentId, uniquePath)
    root = saveCommentary({ ...root, markdown: `![shared](mdr-asset:${sharedAsset.id}) ![unique](mdr-asset:${uniqueAsset.id})`, expectedUpdatedAt: root.updatedAt })
    const child = saveCommentary({ documentId, parentId: root.id, anchor: root.anchor, markdown: '답글' })
    const grandchild = saveCommentary({ documentId, parentId: child.id, anchor: root.anchor, markdown: '두 번째 단계 답글' })
    const other = saveCommentary({ documentId, parentId: null, anchor: root.anchor, markdown: `별도 주석은 보존 ![shared](mdr-asset:${sharedAsset.id})` })
    await wait(`window.deep((${source}),'[data-note-id]').length===4`)
    await noteClick('삭제')
    await wait(`window.deep((${source}),'.deleted').length===1`)
    await new Promise(r=>setTimeout(r,300))
    fs.writeFileSync(path.resolve('.tmp/permanent-delete-083.png'), (await win.webContents.capturePage()).toPNG())
    const deleted = listCommentary(documentId).notes.find(note => note.id === root.id)!
    await noteClick('완전 삭제')
    await wait(`window.deep((${source}),'button').some(b=>b.textContent==='완전 삭제'&&!b.disabled)`)
    assert.match(confirmation.message, /답글 2개/)
    assert.equal(listCommentary(documentId).notes.length, 4)
    const plan = commentaryDeletionPlan(documentId, root.id, deleted.updatedAt)
    saveCommentary({ ...grandchild, markdown: '동시에 수정된 답글', expectedUpdatedAt: grandchild.updatedAt })
    assert.throws(() => permanentlyDeleteCommentary(documentId, root.id, deleted.updatedAt, plan.revision), /답글이 변경/)
    assert.equal(listCommentary(documentId).notes.length, 4)
    confirmDelete = true
    await noteClick('완전 삭제')
    await wait(`window.deep((${source}),'[data-note-id]').length===1`)
    assert.equal(listCommentary(documentId).notes[0].id, other.id)
    assert.deepEqual(listCommentary(documentId).assets.map(asset=>asset.id), [sharedAsset.id])
    assert.equal(await run(`window.deep((${source}),'.deleted').length`), 0)
    closeCommentaryDb()
    assert.equal(listCommentary(documentId).notes.length, 1)
    const invalid = path.join(fixture, 'bad.html'); fs.writeFileSync(invalid, Buffer.from([0xff, 0xfe]))
    await assert.rejects(importCommentaryHtml(invalid), /UTF-8/)
    fs.writeFileSync(invalid, '')
    await assert.rejects(importCommentaryHtml(invalid), /비어 있지/)
    fs.writeFileSync(invalid, 'x'.repeat(8 * 1024 * 1024 + 1))
    await assert.rejects(importCommentaryHtml(invalid), /8 MB/)
    console.log('PASS: HTML file import/drop/whole-document paste/cancel/save/edit/removal; note-only reader and iframe-focused Escape; SVG/MathML/data image rendered; no script/API/network access; restart without source HTML; EPUB static XHTML and fresh-profile round-trip; permanent-delete cancel, descendant count, concurrent-edit guard and full thread removal; unrelated notes/source preserved; invalid and oversized HTML rejected.')
    console.log('Fixture:', fixture)
    closeCommentaryDb(); win.destroy(); app.exit(0)
  } catch (error) {
    console.error(error)
    fs.writeFileSync(path.resolve('.tmp/commentary-html-failure.png'), (await win.webContents.capturePage()).toPNG())
    console.log('Fixture:', fixture)
    closeCommentaryDb(); win.destroy(); app.exit(1)
  }
})
