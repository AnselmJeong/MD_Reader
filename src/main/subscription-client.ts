import { shell } from 'electron'
import { CodexClient, codexClient } from './codex/client'
import { claudeClient } from './claude/client'
import { CLAUDE_MODELS } from '../shared/claude'
import { parseSubscriptionModel, type SubscriptionProvider, type SubscriptionStatus } from '../shared/subscription'
import { validateChatImages } from '../shared/chat-images'
import type { ChatMessageInput } from './ai-chat-types'
import type { ThinkingLevel } from '../shared/chat-request-options'

export interface ChatCompletionParams {
  model: string
  messages: ChatMessageInput[]
  thinkingLevel?: ThinkingLevel
  responseFormat?: { type: 'json_object' }
}

const workers = new Set<CodexClient>()
let closing = false
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const [codex, claude] = await Promise.all([codexClient.status(), claudeClient.status()])
  return { codex, claude }
}
function client(provider: SubscriptionProvider) {
  if (provider === 'codex') return codexClient
  if (provider === 'claude') return claudeClient
  throw new Error('Unknown subscription provider')
}
export async function subscriptionAction(provider: SubscriptionProvider, action: 'login' | 'cancelLogin' | 'logout'): Promise<void> {
  const target = client(provider)
  if (action === 'login') {
    const url = await target.login()
    if (typeof url === 'string') await shell.openExternal(url)
  } else if (action === 'cancelLogin') await target.cancelLogin()
  else if (action === 'logout') {
    if (provider === 'codex') { for (const worker of workers) worker.close(); workers.clear() }
    await target.logout()
  } else throw new Error('Unknown account action')
}
export async function listSubscriptionModels(): Promise<Array<{ name: string; size: number }>> {
  // Defaults remain selectable while signed out, so the user can choose either provider.
  const names = ['codex:default']
  try { names.push(...(await codexClient.models()).map(m => `codex:${m.id}`)) } catch { /* Status UI shows connection errors. */ }
  names.push('claude:default', ...CLAUDE_MODELS.map(m => `claude:${m}`))
  return names.map(name => ({ name, size: 0 }))
}

export async function chatCompletionsStream(params: ChatCompletionParams, onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
  if (closing) throw new Error('MD Reader is closing')
  signal?.throwIfAborted()
  const { provider, model } = parseSubscriptionModel(params.model)
  for (const message of params.messages) validateChatImages(message.images)
  const messages = params.responseFormat ? [
    { role: 'system', content: 'Return only a valid JSON object. Do not use Markdown fences.' }, ...params.messages
  ] : params.messages
  // Each GPT request owns a process: stopping chat cannot cancel title or memory jobs.
  const worker = provider === 'codex' ? new CodexClient() : null
  if (worker) workers.add(worker)
  const abort = () => worker?.close()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const request = { model, messages, thinkingLevel: params.thinkingLevel, signal }
    for await (const token of (worker ?? claudeClient).stream(request)) onToken(token)
  } catch (error) {
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    worker?.close()
    if (worker) workers.delete(worker)
  }
}
export async function chatCompletionsText(params: ChatCompletionParams, signal?: AbortSignal): Promise<string> {
  let text = ''
  await chatCompletionsStream(params, token => { text += token }, signal)
  if (params.responseFormat) {
    text = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')
    const result: unknown = JSON.parse(text)
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('AI가 유효한 JSON 객체를 반환하지 않았습니다.')
  }
  return text
}
export function closeSubscriptions(): void {
  closing = true
  codexClient.close()
  claudeClient.close()
  for (const worker of workers) worker.close()
  workers.clear()
}
