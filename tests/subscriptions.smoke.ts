// Bundle with esbuild --packages=external and run with Electron. All model processes are fixtures.
import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const node = execFileSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).trim()
const root = mkdtempSync(join(tmpdir(), 'md-reader-subscriptions-'))
app.setPath('userData', root)
const request = { model: 'test-model', messages: [{ role: 'system', content: 'Preserve sources.' }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'Document context. Reply in Korean.' }] }
async function collect(stream: AsyncIterable<string>) { let text = ''; for await (const token of stream) text += token; return text }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const { CodexClient, codexInput } = require('../src/main/codex/client')
  const { CodexTransport, codexEnvironment } = require('../src/main/codex/transport')
  const { ClaudeClient, claudeInput } = require('../src/main/claude/client')
  const { claudeEnvironment } = require('../src/main/claude/process')
  const { codexQuotaError } = require('../src/shared/codex')
  const cleanups: Array<() => void> = []
  let count = 0
  async function fixture(provider: string, scenario: string) {
    const home = await mkdtemp(join(root, `${provider}-`)); const log = join(home, 'requests.jsonl')
    const command = [node, resolve(`.tmp/${provider}-fixture.mjs`), scenario, log]
    const client = provider === 'codex' ? new CodexClient(() => new CodexTransport({ home, command, timeoutMs: 700 })) : new ClaudeClient({ home, command, timeoutMs: 1200 })
    cleanups.push(() => client.close())
    return { client, home, calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }
  }
  async function check(name: string, run: () => Promise<void>) { await run(); count++; console.log(`PASS ${name}`) }
  try {
    for (const scenario of ['success', 'early']) await check(`Codex ${scenario}: UTF-8, event order, tools, effort, history`, async () => {
      const { client, calls } = await fixture('codex', scenario)
      assert.equal(await collect(client.stream({ ...request, thinkingLevel: 'high' })), '안녕하세요')
      const log = await calls()
      assert.equal(log.find(c => c.id === 'approval-1').error.code, -32601)
      assert.equal(log.find(c => c.method === 'turn/start').params.effort, 'low')
      assert.equal(log.find(c => c.method === 'thread/start').params.ephemeral, true)
      assert.equal(log.find(c => c.method === 'thread/start').params.developerInstructions, 'Preserve sources.')
      assert.equal(log.find(c => c.method === 'turn/start').params.input[0].text, '[assistant]\nEarlier answer')
    })
    for (const scenario of ['api-key', 'exhausted', 'blocked', 'unknown-quota', 'quota-error']) await check(`Codex blocks ${scenario}`, async () => {
      const { client, calls } = await fixture('codex', scenario)
      await assert.rejects(collect(client.stream(request)))
      assert.equal((await calls()).some(c => ['thread/start', 'turn/start'].includes(c.method)), false)
    })
    for (const scenario of ['crash', 'malformed', 'hang-start', 'limit-turn']) await check(`Codex settles ${scenario}`, async () => {
      const { client } = await fixture('codex', scenario)
      await assert.rejects(collect(client.stream(request)))
      assert.equal((await client.status()).state, 'connected')
    })
    await check('Codex quiet cancellation and independent processes', async () => {
      const a = await fixture('codex', 'hang'), b = await fixture('codex', 'success')
      const controller = new AbortController(); const pending = collect(a.client.stream({ ...request, signal: controller.signal }))
      await wait(200); controller.abort()
      await assert.rejects(pending, { name: 'AbortError' })
      assert.equal(await collect(b.client.stream(request)), '안녕하세요')
      await wait(30)
      assert.ok((await a.calls()).some(c => c.method === 'turn/interrupt'))
    })
    await check('Codex official login and logout', async () => {
      const { client, calls } = await fixture('codex', 'login')
      assert.equal((await client.status()).state, 'signedOut')
      assert.match(await client.login(), /^https:\/\/auth.openai.com\//)
      assert.equal((await client.status()).state, 'signingIn')
      await wait(100); assert.equal((await client.status()).state, 'connected')
      await client.logout(); assert.ok((await calls()).some(c => c.method === 'account/logout'))
    })
    for (const scenario of ['success', 'result-only']) await check(`Claude ${scenario}: text once, no tools, temporary files cleaned`, async () => {
      const { client, calls, home } = await fixture('claude', scenario)
      assert.equal(await collect(client.stream({ ...request, model: 'sonnet' })), '안녕하세요')
      const log = await calls(); const args = log.find(c => c.args?.includes('--print')).args
      assert.equal(args[args.indexOf('--tools') + 1], '')
      for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag))
      assert.ok(!args.includes('--fallback-model'))
      assert.match(log.find(c => c.input).system, /Preserve sources/)
      assert.deepEqual(await readdir(join(home, 'workspace')), [])
    })
    for (const scenario of ['api-key', 'third-party', 'signed-out']) await check(`Claude blocks ${scenario}`, async () => {
      const { client, calls } = await fixture('claude', scenario)
      await assert.rejects(collect(client.stream(request)))
      assert.equal((await calls()).some(c => c.args?.includes('--print')), false)
    })
    for (const scenario of ['quota', 'overage', 'retry-limit', 'limit-result', 'assistant-error', 'malformed', 'crash', 'truncated', 'model-error']) await check(`Claude handles ${scenario}`, async () => {
      const { client, home } = await fixture('claude', scenario)
      await assert.rejects(collect(client.stream(request)))
      assert.deepEqual(await readdir(join(home, 'workspace')), [])
    })
    await check('Claude quiet cancellation', async () => {
      const { client } = await fixture('claude', 'hang')
      const controller = new AbortController(); const pending = collect(client.stream({ ...request, signal: controller.signal }))
      await wait(250); controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
    })
    await check('Claude login cancellation, subscription login, logout', async () => {
      const { client } = await fixture('claude', 'login')
      await client.login(); assert.equal((await client.status()).state, 'signingIn')
      await client.cancelLogin(); assert.equal((await client.status()).state, 'signedOut')
      await client.login(); await wait(300); assert.equal((await client.status()).state, 'connected')
      await client.logout(); assert.equal((await client.status()).state, 'signedOut')
    })
    await check('Native image blocks and API environment isolation', async () => {
      const images = [{ id: 'figure', name: 'figure.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }]
      assert.equal(codexInput([{ role: 'user', content: 'Figure', images }])[1].url, images[0].dataUrl)
      assert.equal(claudeInput([{ role: 'user', content: 'Figure', images }]).message.content[1].source.media_type, 'image/png')
      for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_OPTIONS']) process.env[key] = 'sentinel'
      for (const env of [codexEnvironment('/test'), claudeEnvironment('/test')]) {
        for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'NODE_OPTIONS']) assert.equal(env[key], undefined)
      }
      delete process.env.NODE_OPTIONS
      assert.ok(codexQuotaError({ state: 'connected', ordinaryUsageAllowed: null, quotas: [{ id: 'codex', primary: { usedPercent: 0 }, secondary: null }] }, 'test'))
    })
    await check('Migration removes credentials, preserves search and reading settings', async () => {
      await writeFile(join(root, 'md-reader-ai-provider-settings.json'), JSON.stringify({ ollamaApiKey: 'obsolete-secret', ollamaBaseUrl: 'http://old', tinyfishApiKey: 'preserved', webSearchEnabled: false }))
      await writeFile(join(root, 'md-reader-settings.json'), JSON.stringify({ ollamaModel: 'old-model', fontSize: 21, theme: 'sepia', systemPrompt: 'My prompt' }))
      await writeFile(join(root, 'agent-memory-settings.json'), JSON.stringify({ extractorModel: 'old-model', enabled: false }))
      const { getAgentMemorySettings } = require('../src/main/agent-memory-settings')
      assert.equal(getAgentMemorySettings().extractorModel, '')
      assert.equal(getAgentMemorySettings().enabled, false)
      const { getAiProviderConfig } = require('../src/main/ai-provider-settings')
      const { getSettings } = require('../src/main/settings-service')
      assert.equal(getAiProviderConfig().tinyfishApiKey, 'preserved')
      assert.equal(getAiProviderConfig().webSearchEnabled, false)
      assert.equal(getSettings('fontSize'), 21)
      assert.equal(getSettings('aiModel'), 'codex:default')
      assert.equal(getSettings('systemPrompt'), 'My prompt')
      assert.ok(!(await readFile(join(root, 'md-reader-ai-provider-settings.json'), 'utf8')).includes('obsolete-secret'))
    })
    await check('All generation paths use subscriptions with no HTTP fallback', async () => {
      const { claudeClient } = require('../src/main/claude/client')
      const { chatCompletionsText, chatCompletionsStream } = require('../src/main/subscription-client')
      const { generateChatTitle, generateJsonResponse } = require('../src/main/ai-service')
      const { streamGroundedChat } = require('../src/main/ai-chat-service')
      globalThis.fetch = async () => { assert.fail('Unexpected HTTP fallback') }
      claudeClient.stream = async function* () { throw new Error('subscription exhausted') }
      for (const run of [() => chatCompletionsText({ ...request, model: 'claude:sonnet' }), () => chatCompletionsStream({ ...request, model: 'claude:sonnet' }, () => {}), () => generateChatTitle({ ...request, model: 'claude:sonnet', contextTitle: 'Document' }), () => generateJsonResponse({ model: 'claude:sonnet', systemPrompt: 'JSON', userPrompt: 'Memory' }), () => streamGroundedChat({ ...request, model: 'claude:sonnet' }, { onToken: () => {} })]) await assert.rejects(run(), /subscription exhausted/)
      await assert.rejects(chatCompletionsText({ ...request, model: 'old-ollama-model' }), /구독 모델/)
    })
    console.log(`PASS ${count} subscription checks`)
    for (const cleanup of cleanups) cleanup()
    await wait(100); await rm(root, { recursive: true, force: true }); app.exit(0)
  } catch (error) { console.error(error); for (const cleanup of cleanups) cleanup(); app.exit(1) }
})
