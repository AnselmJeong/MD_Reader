// npm run build && npx esbuild tests/chat-images.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/chat-images.cjs
// node_modules/.bin/electron .tmp/chat-images.cjs
import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-vision-'))
const profile = path.join(fixture, 'profile')
fs.mkdirSync(profile)
app.setPath('userData', profile)

delete process.env.TINYFISH_API_KEY
fs.writeFileSync(path.join(profile, 'agent-memory-settings.json'), JSON.stringify({ enabled: false }))
const doc = path.join(fixture, 'figure.md')
fs.writeFileSync(doc, '# Image questions\n\nA document with a table and figure.')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [doc] })
const exported = path.join(fixture, 'Chat Export.md')
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
const requests: any[] = []
globalThis.fetch = async (input, init) => {
 const url = String(input)
 if (url.endsWith('/models')) return Response.json({ data: ['vision-model', 'text-model', 'unknown-model'].map(id => ({ id })) })
 if (url.endsWith('/api/show')) {
  const model = JSON.parse(String(init?.body)).model
  return model === 'unknown-model' ? new Response('', { status: 404 }) : Response.json({ capabilities: model === 'vision-model' ? ['completion', 'vision'] : ['completion'] })
 }
 if (url.endsWith('/chat/completions')) {
  const body = JSON.parse(String(init?.body))
  if (!body.stream) return Response.json({ choices: [{ message: { content: 'Image questions' } }] })
  requests.push(body)
  return new Response('data: '+JSON.stringify({ choices: [{ delta: { content: '첨부 그림을 확인했습니다.' } }] })+'\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
 }
 throw Error('Unexpected request: '+url)
}
app.whenReady().then(async () => {
 require('./helpers/subscription-mock').installSubscriptionMock()
 const { registerIpcHandlers } = require('../src/main/ipc-handlers')
 const { getChatDb, saveChatSession, loadChatSession, loadChatSessionWithContext } = require('../src/main/chat-session-service')
 const { validateChatImages } = require('../src/shared/chat-images')
 const { validateChatImageMessages, writeChatExport } = require('../src/main/chat-image-service')
 registerIpcHandlers()
 const win = new BrowserWindow({ show: true, width: 1250, height: 900, webPreferences: { preload: path.resolve('out/preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false } })
 const run = (code: string) => win.webContents.executeJavaScript(code)
 const wait = async (code: string) => { for (let i=0;i<200;i++) { if (await run(code)) return; await new Promise(r=>setTimeout(r,50)) } throw Error('Timeout: '+code) }
 const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
 const model = async (name: string) => { await run(`(()=>{const e=Array.from(document.querySelectorAll('select')).find(e=>Array.from(e.options).some(o=>o.value==='codex:vision-model'));e.value=${JSON.stringify(`codex:${name}`)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await wait(`!document.body.textContent.includes('모델의 이미지 지원 여부 확인 중')`) }
 const fill = (text: string) => run(`(()=>{const e=document.querySelector('.chat-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 try {
  let png = nativeImage.createFromBitmap(Buffer.alloc(100*60*4, 200), {width:100,height:60}).toDataURL()
  const image = {id:'fixture-image',name:'figure.png',dataUrl:png}
  assert.throws(()=>validateChatImages(Array(5).fill(image)))
  assert.throws(()=>validateChatImages([{...image,dataUrl:'https://example.org/figure.png'}]))
  assert.throws(()=>validateChatImageMessages([{role:'assistant',content:'',images:[image]}]))
  assert.throws(()=>validateChatImageMessages([{role:'user',content:'',images:[{...image,dataUrl:'data:image/png;base64,YWJj'}]}]))
  const contextMeta = {documentKind:'markdown',documentId:'fixture',fileName:'fixture.md',contextTitle:'Fixture'}
  const saved = saveChatSession({contextMeta,messages:[{id:'image-message',role:'user',content:'Describe',timestamp:1,images:[image]}]})
  assert.deepEqual(loadChatSession(saved.sessionId).messages[0].images,[image])
  assert.equal(loadChatSessionWithContext(saved.sessionId).messages[0].images,undefined)
  assert.throws(()=>saveChatSession({sessionId:saved.sessionId,contextMeta,messages:[{id:'image-message',role:'user',content:'Broken',timestamp:1,images:[{...image,dataUrl:'invalid'}]}]}))
  assert.equal(loadChatSession(saved.sessionId).messages[0].content,'Describe')
  getChatDb().pragma('wal_checkpoint(FULL)')
  const reopened = new Database(path.join(profile,'chat-sessions.sqlite'),{readonly:true})
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM chat_message_images').get().n,1);reopened.close()
  await writeChatExport(exported,'![Figure](mdr-chat-image:fixture-image)',[image])
  assert.ok(fs.readFileSync(exported,'utf8').includes('Chat%20Export.assets/'))
  assert.equal(fs.readdirSync(path.join(fixture,'Chat Export.assets')).length,1)
  await win.loadFile(path.resolve('out/renderer/index.html'))
  await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
  await click('button[title="Open File (⌘O)"]')
  await wait(`!!document.querySelector('.chat-composer textarea') && !document.querySelector('.chat-composer textarea').disabled`)
  png = await run(`(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,640,360);x.fillStyle='#17212b';x.font='bold 38px sans-serif';x.fillText('VISION CHECK 4729',40,60);x.fillStyle='#d64b49';x.fillRect(60,120,150,150);x.fillStyle='#346fbd';x.beginPath();x.arc(420,195,75,0,Math.PI*2);x.fill();return c.toDataURL('image/png')})()`)
  fs.writeFileSync(path.resolve('.tmp/vision-probe.png'),Buffer.from(png.split(',')[1],'base64'))
  await model('text-model')
  await run(`(async()=>{const blob=await (await fetch(${JSON.stringify(png)})).blob();window.testFile=new File([blob],'screenshot.png',{type:'image/png'});const data=new DataTransfer();data.items.add(window.testFile);document.querySelector('.chat-composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`)
  await wait(`document.querySelectorAll('.chat-composer .chat-image-preview').length===1 && document.querySelector('.chat-image-warning')?.textContent.includes('지원하지 않습니다')`)
  await fill('이 그림의 의미는?')
  assert.equal(await run(`document.querySelector('button[aria-label="질문 보내기"]').disabled`),true)
  assert.equal(requests.length,0)
  assert.equal(await run(`document.querySelector('.chat-composer textarea').value`),'이 그림의 의미는?')
  await click('.chat-composer .chat-image-preview')
  await wait(`!!document.querySelector('.epub-image-dialog[open]')`)
  await click('button[aria-label="그림 닫기"]')
  await model('unknown-model')
  await wait(`document.querySelector('.chat-image-warning')?.textContent.includes('확인하지 못했습니다')`)
  assert.equal(await run(`document.querySelector('button[aria-label="질문 보내기"]').disabled`),false)
  await model('vision-model')
  await wait(`!document.querySelector('button[aria-label="질문 보내기"]').disabled`)
  await run(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,100))))`)
  fs.writeFileSync(path.resolve('.tmp/chat-images-composer.png'),(await win.webContents.capturePage()).toPNG())
  await click('button[aria-label="질문 보내기"]')
  await wait(`document.querySelectorAll('.chat-message-content').length===2 && !document.querySelector('button[title="Stop response (Esc)"]')`)
  assert.equal(requests.length,1)
  const question = requests[0].messages.at(-1)
  assert.equal(question.content[0].text,'이 그림의 의미는?')
  assert.equal(question.content[1].type,'image_url')
  assert.match(question.content[1].image_url.url,/^data:image\/png;base64,/)
  assert.equal(await run(`document.querySelectorAll('.chat-composer .chat-image-preview').length`),0)
  await fill('그림의 색도 설명해 줘')
  await click('button[aria-label="질문 보내기"]')
  await wait(`document.querySelectorAll('.chat-message-content').length===4 && !document.querySelector('button[title="Stop response (Esc)"]')`)
  assert.equal(requests.length,2)
  assert.ok(requests[1].messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url')))
  await model('text-model')
  await wait(`document.querySelector('.chat-image-warning')?.textContent.includes('새 대화를 시작')`)
  await fill('다음 질문')
  assert.equal(await run(`document.querySelector('button[aria-label="질문 보내기"]').disabled`),true)
  const rejected = await run(`window.api.ai.chat({model:'codex:text-model',messages:[{role:'user',content:'test',images:[${JSON.stringify(image)}]}]})`)
  assert.ok(rejected.error.includes('지원하지 않습니다'));assert.equal(requests.length,2)
  await run(`document.querySelector('button[aria-label="대화 내보내기"]').click()`)
  await wait(`window.api.chat.listSessions({documentKind:'markdown',documentId:'fixture',fileName:'fixture.md',contextTitle:'Fixture'}).then(()=>true)`)
  // Reopen the persisted conversation through the real IPC and renderer session selector.
  await run(`document.querySelector('button[aria-label="새 대화"]').click()`)
  await wait(`document.querySelectorAll('.chat-image-preview').length===0`)
  await run(`(()=>{const e=Array.from(document.querySelectorAll('select')).find(e=>Array.from(e.options).some(o=>o.value.startsWith('session-')));e.value=Array.from(e.options).find(o=>o.value.startsWith('session-')).value;e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait(`document.querySelectorAll('.chat-image-preview').length===1`)
  await run(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,100))))`)
  fs.writeFileSync(path.resolve('.tmp/chat-images-history.png'),(await win.webContents.capturePage()).toPNG())
  console.log('PASS: clipboard image, preview/zoom, model capability warnings, blocked send preserves draft, multimodal request/history, SQLite persistence and atomic rejection, image export, session reload.')
  win.destroy();app.exit(0)
 } catch(error) {console.error(error);fs.writeFileSync(path.resolve('.tmp/chat-images-failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();app.exit(1)}
}).finally(()=>fs.rmSync(fixture,{recursive:true,force:true}))
