import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import Database from 'better-sqlite3'
const root = mkdtempSync(join(tmpdir(), 'md-reader-hindsight-'))
app.setPath('userData', root)
writeFileSync(join(root, 'agent-memory-settings.json'), JSON.stringify({ enabled: false, mem0BaseUrl: 'https://retired.invalid', mem0ApiKey: 'old-secret', userId: 'old-user' }))
app.whenReady().then(async () => {
  const requests: any[] = []
  let scenario = 'ok'
  let bankExists = true
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = text ? JSON.parse(text) : null
    requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, body })
    res.setHeader('Content-Type', 'application/json')
    if (scenario === 'denied') { res.writeHead(401); return res.end('{}') }
    if (scenario === 'slow') return
    if (scenario === 'dashboard' || scenario === 'dashboard-ok') {
      res.writeHead(scenario === 'dashboard' ? 404 : 200, { 'Content-Type': 'text/html' }); return res.end('<html>Control Plane</html>')
    }
    if (req.url?.startsWith('/control/v1/')) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html>Control Plane</html>') }
    if (req.method === 'GET' && (req.url?.includes('/banks?limit=1'))) return res.end(JSON.stringify({ banks: [] }))
    if (req.url?.endsWith('/stats') || req.url?.includes('/api/stats/')) {
      if (!bankExists) { res.writeHead(404); return res.end('{"detail":"Bank not found"}') }
      return res.end(JSON.stringify(scenario === 'wrong-json' ? {} : { bank_id: 'MD-reader', total_nodes: 8 }))
    }
    if (req.method === 'PUT' || (req.method === 'POST' && req.url?.endsWith('/api/banks'))) { bankExists = true; return res.end(JSON.stringify({ bank_id: 'MD-reader' })) }
    if ((req.url?.endsWith('/memories/recall') || req.url?.endsWith('/api/recall'))) return res.end(JSON.stringify({ results: [{ id: 'fact', text: 'Prefer source-grounded answers' }, { id: 'empty', text: '' }] }))
    if ((req.url?.endsWith('/memories') || req.url?.endsWith('/api/memories/retain'))) return res.end(JSON.stringify({ success: scenario !== 'failed', async: scenario === 'async', items_count: 1 }))
    res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { getAgentMemorySettings, updateAgentMemorySettings, connectAgentMemorySettings } = require('../src/main/agent-memory-settings')
    const { ensureHindsightBank, retainHindsightMemory, recallHindsight, checkHindsightHealth } = require('../src/main/hindsight-client')
    const { migrateAgentMemorySchema } = require('../src/main/chat-session-service')
    const initial = getAgentMemorySettings()
    assert.equal(initial.hindsightBankId, 'MD-reader'); assert.equal(initial.enabled, false)
    assert.equal(initial.hindsightApiKey, ''); assert.equal(initial.hindsightBaseUrl, 'https://hindsight.ecoplay.cloud')
    assert.doesNotMatch(readFileSync(join(root, 'agent-memory-settings.json'), 'utf8'), /old-secret|mem0|old-user/)
    console.log('PASS legacy settings migration preserves toggles and removes retired credentials')
    const address = server.address() as any
    const settings = updateAgentMemorySettings({ hindsightBaseUrl: `http://127.0.0.1:${address.port}/proxy/`, hindsightBankId: 'MD-reader', hindsightApiKey: 'fixture-key' })
    bankExists = false
    await ensureHindsightBank(settings)
    assert.deepEqual(requests.at(-2), { path: '/proxy/v1/default/banks/MD-reader', method: 'PUT', auth: 'Bearer fixture-key', body: {} })
    assert.equal((await checkHindsightHealth(settings)).ok, true)
    assert.equal(requests.at(-1).path, '/proxy/v1/default/banks/MD-reader/stats')
    console.log('PASS bank creation, reverse proxy paths, bearer auth, read-only health')
    requests.length = 0
    await ensureHindsightBank(settings)
    assert.deepEqual(requests.map(r => r.method), ['GET'])
    const before = readFileSync(join(root, 'agent-memory-settings.json'), 'utf8')
    for (const failure of ['dashboard', 'dashboard-ok', 'wrong-json', 'denied']) {
      scenario = failure
      await assert.rejects(connectAgentMemorySettings({ enabled: true, hindsightApiKey: 'replacement-key' }))
      assert.equal(readFileSync(join(root, 'agent-memory-settings.json'), 'utf8'), before)
    }
    assert.throws(() => updateAgentMemorySettings({ hindsightBaseUrl: 'https://example.com/dashboard' }), /dashboard/)
    scenario = 'ok'
    await connectAgentMemorySettings({ enabled: true })
    assert.equal(getAgentMemorySettings().enabled, true)
    scenario = 'denied'
    await connectAgentMemorySettings({ enabled: false })
    assert.equal(getAgentMemorySettings().enabled, false)
    scenario = 'ok'
    console.log('PASS existing banks connect read-only; dashboard and invalid APIs cannot overwrite settings; offline disable works')

    const params = { content: 'Prefer source-grounded answers', metadata: { session_id: 'session1', confidence: 0.9, tags: ['reading'], chapter: null } }
    const first = await retainHindsightMemory(settings, params)
    const second = await retainHindsightMemory(settings, params)
    assert.equal(first.memoryId, second.memoryId)
    const item = requests.at(-1).body.items[0]
    assert.equal(item.metadata.confidence, '0.9'); assert.equal(item.metadata.tags, '["reading"]'); assert.equal(item.metadata.chapter, undefined)
    assert.equal(requests.at(-1).body.async, false)
    const recalled = await recallHindsight(settings, 'preferences')
    assert.equal(recalled.length, 1); assert.equal(recalled[0].memory, params.content)
    assert.equal(requests.at(-1).body.max_tokens, 1200)
    console.log('PASS synchronous retain confirmation, stable document IDs, string metadata and recall')
    const remote = { ...settings, hindsightBaseUrl: `http://127.0.0.1:${address.port}/control` }
    requests.length = 0
    await ensureHindsightBank(remote)
    assert.deepEqual(requests.map(r => r.path), ['/control/v1/default/banks?limit=1', '/control/api/banks?limit=1', '/control/api/stats/MD-reader'])
    await retainHindsightMemory(remote, params)
    assert.equal(requests.at(-1).path, '/control/api/memories/retain')
    assert.equal(requests.at(-1).body.bank_id, 'MD-reader')
    assert.equal(requests.at(-1).body.items[0].document_id, first.memoryId)
    assert.equal((await recallHindsight(remote, 'preferences'))[0].memory, params.content)
    assert.equal(requests.at(-1).path, '/control/api/recall')
    assert.equal(requests.at(-1).body.bank_id, 'MD-reader')
    bankExists = false
    await ensureHindsightBank(remote)
    assert.equal(requests.at(-2).path, '/control/api/banks')
    assert.equal(requests.at(-2).method, 'POST')
    assert.deepEqual(requests.at(-2).body, { bank_id: 'MD-reader' })
    console.log('PASS remote Control Plane discovery, bank creation, retention and recall on configured origin')

    for (const failure of ['failed', 'async', 'denied']) {
      scenario = failure; await assert.rejects(retainHindsightMemory(settings, params))
    }
    assert.equal((await checkHindsightHealth(settings)).ok, false)
    scenario = 'slow'
    await assert.rejects(recallHindsight(settings, 'query', 5, AbortSignal.timeout(50)))
    scenario = 'ok'
    assert.throws(() => updateAgentMemorySettings({ hindsightBaseUrl: 'file:///tmp/server' }))
    assert.throws(() => updateAgentMemorySettings({ hindsightBankId: '../other' }))
    updateAgentMemorySettings({ hindsightApiKey: '' }); assert.equal(getAgentMemorySettings().hindsightApiKey, '')
    console.log('PASS outage/auth/cancellation, no false completed retention, URL validation and key clearing')
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE chat_sessions (id TEXT PRIMARY KEY); INSERT INTO chat_sessions VALUES ('s');`)
    // Seed the real historical schema before the Hindsight migration marker exists.
    db.exec(`CREATE TABLE app_schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO app_schema_migrations VALUES ('hindsight-v1', 1);`)
    migrateAgentMemorySchema(db)
    db.exec(`DELETE FROM app_schema_migrations;
      INSERT INTO agent_memory_runs (id,session_id,context_key,status,transcript_hash,input_message_count,created_at,mem0_event_ids)
        VALUES ('r','s','ctx','completed','hash',2,1,'["legacy-event"]');
      INSERT INTO agent_memory_items (id,run_id,session_id,kind,content,confidence,evidence_message_ids,status,mem0_id,metadata_json,created_at)
        VALUES ('i','r','s','insight','Prior insight',0.9,'[]','sent_to_mem0','legacy-id','{}',1);`)
    migrateAgentMemorySchema(db); migrateAgentMemorySchema(db)
    const row = db.prepare('SELECT * FROM agent_memory_items').get() as any
    assert.equal(row.content, 'Prior insight'); assert.equal(row.status, 'stored'); assert.equal(row.remote_document_id, 'legacy-id'); assert.equal(row.backend, 'legacy_mem0')
    assert.equal((db.prepare('SELECT remote_event_ids FROM agent_memory_runs').get() as any).remote_event_ids, '["legacy-event"]')
    db.prepare("INSERT INTO agent_memory_items SELECT 'new',run_id,session_id,kind,content,confidence,evidence_message_ids,target,'stored','doc',metadata_json,created_at,'hindsight' FROM agent_memory_items WHERE id='i'").run()
    assert.equal((db.prepare('SELECT count(*) AS n FROM agent_memory_items').get() as any).n, 2)
    db.close()
    console.log('PASS repeat-safe SQLite migration preserves legacy records and accepts Hindsight records')
  } finally {
    server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true })
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
