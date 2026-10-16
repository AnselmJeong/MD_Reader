// Bridge existing UI fixtures to the subscription contract; never starts a real CLI.
export function installSubscriptionMock() {
  const { CodexClient } = require('../../src/main/codex/client')
  const { ClaudeClient } = require('../../src/main/claude/client')
  const { effectiveThinkingLevel } = require('../../src/shared/chat-request-options')
  CodexClient.prototype.status = async () => ({ state: 'connected', ordinaryUsageAllowed: true, quotas: [] })
  ClaudeClient.prototype.status = async () => ({ state: 'connected', plan: 'test' })
  CodexClient.prototype.models = async () => {
    const response = await fetch('https://subscription-fixture.invalid/models')
    const data = await response.json()
    return Promise.all(data.data.filter((m: any) => !m.id.startsWith('claude:')).map(async (m: any, i: number) => {
      let inputModalities: string[] = []
      try {
        const show = await fetch('https://subscription-fixture.invalid/api/show', { method: 'POST', body: JSON.stringify({ model: m.id }) })
        if (show.ok) inputModalities = (await show.json()).capabilities.includes('vision') ? ['text', 'image'] : ['text']
      } catch { /* Older text-only fixtures do not implement capabilities. */ }
      return { id: m.id, isDefault: i === 0, inputModalities, reasoningEfforts: ['none', 'low', 'medium', 'high'], defaultReasoningEffort: 'none' }
    }))
  }
  async function* stream(request: any) {
    const messages = request.messages.map((m: any) => ({ ...m, content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map((image: any) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] : m.content }))
    const jsonMode = messages[0]?.content === 'Return only a valid JSON object. Do not use Markdown fences.'
    if (jsonMode) messages.shift()
    const background = jsonMode || messages[0]?.content.includes('Create a concise chat session title')
    const response = await fetch('https://subscription-fixture.invalid/chat/completions', { method: 'POST', signal: request.signal, body: JSON.stringify({
      model: request.model, messages, stream: !background,
      reasoning_effort: effectiveThinkingLevel(this instanceof ClaudeClient ? `claude:${request.model}` : request.model, request.thinkingLevel),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    }) })
    if (background) { yield (await response.json()).choices[0].message.content; return }
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const chunk of response.body as any) {
      buffer += decoder.decode(chunk, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        yield JSON.parse(line.slice(6)).choices[0].delta.content || ''
      }
    }
  }
  CodexClient.prototype.stream = stream
  ClaudeClient.prototype.stream = stream
}
