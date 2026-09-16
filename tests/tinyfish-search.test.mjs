import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTinyFishWeb, fetchTinyFishPages } from '../src/main/tinyfish-web-search-service.ts'

test('TinyFish search uses its own key and normalizes valid results with stable IDs', async () => {
  const result = await searchTinyFishWeb('  neural   dynamics ', 'private-test-key', { fetchImpl: async (url, init) => {
    assert.equal(String(url), 'https://api.search.tinyfish.ai?query=neural+dynamics&language=en')
    assert.equal(init.headers['X-API-Key'], 'private-test-key')
    assert.ok(init.signal)
    return Response.json({ results: [null, {url:'javascript:bad'}, {url:'https://example.org/a',title:'A',snippet:'evidence'}, {url:'https://example.org/a'}, {url:'https://example.org/b', title:'B'}] })
  } })
  assert.deepEqual(result.map(s=>[s.id,s.title]), [['S1','A'],['S2','B']])
  assert.equal(result[0].snippet, 'evidence')
})

test('fetch uses one bounded batch and preserves only requested HTTP sources', async () => {
  const result = await fetchTinyFishPages(['https://example.org/a','https://example.org/b'], 'test-key', { fetchImpl: async (url,init) => {
    assert.equal(url, 'https://api.fetch.tinyfish.ai')
    assert.deepEqual(JSON.parse(init.body), {urls:['https://example.org/a','https://example.org/b'],format:'markdown',per_url_timeout_ms:3000})
    return Response.json({results:[{url:'https://example.org/a',text:'Full content'},{url:'https://other.org',text:'Unrequested'}]})
  } })
  assert.equal(result.length, 1)
  assert.equal(result[0].content, 'Full content')
})

test('missing key, invalid payload, HTTP errors, timeout, and cancellation fail explicitly', async () => {
  await assert.rejects(searchTinyFishWeb('q',''), /TinyFish API key/)
  await assert.rejects(searchTinyFishWeb('q','key',{fetchImpl:async()=>Response.json({bad:true})}), /invalid response/)
  await assert.rejects(searchTinyFishWeb('q','key',{fetchImpl:async()=>new Response('',{status:429})}), /429/)
  const pending = (_url, {signal}) => new Promise((_resolve,reject) => {
    if(signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
  })
  // Keep the event loop alive because AbortSignal.timeout uses an unref'ed timer.
  const keepAlive=setTimeout(()=>{},1000)
  try { await assert.rejects(searchTinyFishWeb('q','key',{fetchImpl:pending,timeoutMs:10}), {name:'TimeoutError'}) }
  finally {clearTimeout(keepAlive)}
  await assert.rejects(searchTinyFishWeb('q','key',{fetchImpl:pending,signal:AbortSignal.abort()}), {name:'AbortError'})
})
