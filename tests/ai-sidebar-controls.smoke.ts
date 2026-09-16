// npm run build
// npx esbuild tests/ai-sidebar-controls.smoke.ts --bundle --platform=node --packages=external --outfile=.tmp/ai-sidebar-controls.cjs
// node_modules/.bin/electron .tmp/ai-sidebar-controls.cjs
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-ai-'))
fs.mkdirSync(path.join(fixture,'profile'))
app.setPath('userData',path.join(fixture,'profile'))
process.env.OLLAMA_API_KEY = 'test-chat-key'
delete process.env.TINYFISH_API_KEY
fs.writeFileSync(path.join(fixture,'profile','agent-memory-settings.json'),JSON.stringify({enabled:false}))
const doc = path.join(fixture,'paper.md')
fs.writeFileSync(doc,'# Neural Dynamics\n\nA study of neural network energy.')
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[doc]})
const calls:string[]=[]
let expectedThinking = 'none'
let expectedSearch = false
const reply=String.raw`대칭 조건은 $w_{ij}=w_{ji}$ 입니다.

$$
E = -\frac{1}{2}\sum_{ij} w_{ij}s_i s_j
$$

표준 수식 $x^2$도 지원합니다. [S1]`
globalThis.fetch=async(input,init)=>{
 const url=String(input)
 if(url.endsWith('/models'))return Response.json({data:[{id:'test-model'},{id:'gpt-oss:20b'}]})
 if(url.startsWith('https://api.search.tinyfish.ai?')){
  calls.push('TinyFish search')
  assert.equal(new URL(url).searchParams.get('language'),'en')
  assert.equal(new URL(url).searchParams.get('query'),'symmetric neural network weights energy function research')
  assert.equal(new Headers(init?.headers).get('X-API-Key'),'test-search-key')
  return Response.json({results:[{url:'https://example.org/research',title:'Network evidence',snippet:'Symmetric weights support an energy function.'}]})
 }
 if(url==='https://api.fetch.tinyfish.ai'){
  calls.push('TinyFish fetch')
  return new Response('',{status:504})
 }
 if(url.endsWith('/chat/completions')){
  const body=JSON.parse(String(init?.body))
  if(!body.stream && body.messages[0]?.content.includes('English web search query')){
   calls.push('English query')
   assert.equal(body.response_format?.type,'json_object')
   assert.equal(body.reasoning_effort,'none')
   assert.match(JSON.parse(body.messages[1].content).researchRequest,/홉필드/)
   return Response.json({choices:[{message:{content:JSON.stringify({query:'symmetric neural network weights energy function research'})}}]})
  }
  if(!body.stream)return Response.json({choices:[{message:{content:'Neural dynamics'}}]})
  calls.push('Answer')
  assert.equal(body.reasoning_effort,expectedThinking)
  assert.equal(body.messages[0].content.includes('Web research evidence available'),expectedSearch)
  if(expectedSearch) assert.ok(body.messages[0].content.includes('Symmetric weights'))
  const encoder=new TextEncoder()
  return new Response(new ReadableStream({start(controller){
   for(const chunk of [reply.slice(0,50),reply.slice(50)])controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:chunk}}]})+'\n\n'))
   controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close()
  }}),{headers:{'Content-Type':'text/event-stream'}})
 }
 throw new Error('Unexpected endpoint: '+url)
}
app.whenReady().then(async()=>{
 const {registerIpcHandlers}=require('../src/main/ipc-handlers')
 const {getAiProviderConfig,updateAiProviderSettings}=require('../src/main/ai-provider-settings')
 const {shouldRunWebSearch,streamGroundedChat}=require('../src/main/ai-chat-service')
 const {effectiveThinkingLevel}=require('../src/shared/chat-request-options')
 registerIpcHandlers()
 assert.equal(shouldRunWebSearch({model:'test-model',messages:[{role:'user',content:'search evidence'}]}),false)
 const win=new BrowserWindow({show:true,width:1200,height:900,webPreferences:{preload:path.resolve('out/preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}})
 const run=(code:string)=>win.webContents.executeJavaScript(code)
 const wait=async(code:string)=>{for(let i=0;i<160;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out: '+code)}
 const click=async(selector:string)=>run(`document.querySelector(${JSON.stringify(selector)}).click()`)
 try{
  const params={model:'test-model',messages:[{role:'user',content:'search evidence'}]}
  await assert.rejects(streamGroundedChat({...params,webSearch:true},{onToken:()=>assert.fail('must not answer without requested search configuration')}),/TinyFish/)
  assert.deepEqual(calls,[])
  assert.equal(effectiveThinkingLevel('test-model','invalid'),'none')
  assert.equal(effectiveThinkingLevel('gpt-oss:20b','none'),'low')
  assert.equal(effectiveThinkingLevel('gpt-oss:120b-cloud','high'),'high')
  await win.loadFile(path.resolve('out/renderer/index.html'))
  await wait(`!!document.querySelector('button[title="Open File (⌘O)"]')`)
  await click('button[title="Open File (⌘O)"]')
  await wait(`document.body.textContent.includes('Neural Dynamics')`)
  await click('button[title="Settings"]')
  await wait(`!!document.querySelector('#tinyfish-api-key')`)
  await run(`(()=>{const input=document.querySelector('#tinyfish-api-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'test-search-key');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('#tinyfish-api-key').parentElement.parentElement.querySelector('button').click()`)
  await wait(`document.querySelector('label[for="tinyfish-api-key"]').textContent.includes('(saved)')`)
  assert.equal(getAiProviderConfig().tinyfishApiKey,'test-search-key')
  assert.equal(shouldRunWebSearch(params),false)
  assert.equal(shouldRunWebSearch({...params,webSearch:false}),false)
  assert.equal(shouldRunWebSearch({...params,webSearch:'true'}),false)
  assert.equal(shouldRunWebSearch({...params,webSearch:true}),true)
  assert.equal(shouldRunWebSearch({...params,webSearch:true,memoryContext:{userText:'요약',quotedText:'a selected passage'}}),true)
  updateAiProviderSettings({webSearchEnabled:false})
  assert.equal(shouldRunWebSearch({...params,webSearch:true}),false)
  await assert.rejects(streamGroundedChat({...params,webSearch:true},{onToken:()=>{}}),/TinyFish/)
  updateAiProviderSettings({webSearchEnabled:true})
  updateAiProviderSettings({tinyfishApiKey:''})
  assert.equal(getAiProviderConfig().tinyfishApiKey,'test-search-key')
  assert.equal(await run(`window.api.aiProvider.status().then(status => JSON.stringify(status).includes('test-search-key'))`),false)
  fs.writeFileSync(path.resolve('.tmp/tinyfish-settings.png'),(await win.webContents.capturePage()).toPNG())
  await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Done').click()`)
  await wait(`!!document.querySelector('textarea[placeholder="Ask about the document..."]')`)
  const assertDefaults=async()=>{
   assert.equal(await run(`document.querySelector('button[aria-label="웹 검색"]').getAttribute('aria-pressed')`),'false')
   assert.equal(await run(`document.querySelector('select[aria-label="Thinking 수준"]').value`),'none')
  }
  const chooseThinking=async(level:string)=>run(`(()=>{const select=document.querySelector('select[aria-label="Thinking 수준"]');select.value=${JSON.stringify(level)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  let sent=0
  const send=async()=>{
   calls.length=0
   await run(`(()=>{const input=document.querySelector('textarea[placeholder="Ask about the document..."]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'홉필드 네트워크의 에너지 함수와 대칭 가중치에 관한 논문을 검색해줘');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
   await run(`document.querySelector('textarea[placeholder="Ask about the document..."]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
   sent++
   await wait(`document.querySelectorAll('.chat-message-content .katex-display').length===${sent}`)
   await wait(`!document.querySelector('button[title="Stop response (Esc)"]')`)
   await assertDefaults()
  }
  await assertDefaults()
  await send()
  assert.deepEqual(calls,['Answer'])
  await click('button[aria-label="웹 검색"]')
  await chooseThinking('high')
  expectedThinking='high';expectedSearch=true
  await send()
  assert.deepEqual(calls,['English query','TinyFish search','TinyFish fetch','Answer'])
  expectedThinking='none';expectedSearch=false
  await send()
  assert.deepEqual(calls,['Answer'])
  for(const level of ['low','medium']){
   await chooseThinking(level)
   expectedThinking=level
   await send()
   assert.deepEqual(calls,['Answer'])
  }
  assert.equal(await run(`document.querySelectorAll('.chat-message-content .katex-error').length`),0)
  await run(`(()=>{const select=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='gpt-oss:20b'));select.value='gpt-oss:20b';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait(`document.body.textContent.includes('None 대신 Low')`)
  expectedThinking='low'
  await send()
  assert.deepEqual(calls,['Answer'])
  await click('button[aria-label="웹 검색"]')
  await chooseThinking('high')
  await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New').click()`)
  await wait(`document.querySelectorAll('.chat-message-content .katex-display').length===0`)
  await assertDefaults()
  fs.writeFileSync(path.resolve('.tmp/ai-sidebar-math.png'),(await win.webContents.capturePage()).toPNG())
  console.log('PASS: default no-search/none, explicit search opt-in, all thinking levels through renderer/preload/IPC/provider, next-question and new-session resets, GPT-OSS minimum Low notice, missing/disabled search configuration, TinyFish key UI, English search/fetch routing, snippet fallback and streamed KaTeX rendering (mocked providers).')
  win.destroy();fs.rmSync(fixture,{recursive:true,force:true});app.exit(0)
 }catch(error){console.error(error);fs.writeFileSync(path.resolve('.tmp/ai-sidebar-failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();fs.rmSync(fixture,{recursive:true,force:true});app.exit(1)}
})
