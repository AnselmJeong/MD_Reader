// Stands in for src/main/subscription-client.ts in coach smoke tests: no CLI, a fixed card.
export async function getSubscriptionStatus() { return { providers: [] } as never }
export async function subscriptionAction() {}
export async function listSubscriptionModels() { return [] }
export async function chatCompletionsStream() {}
/** The prompts of chapter-deck calls, so a test can tell which chapters were prepared. */
export const deckCalls: string[] = []
export async function chatCompletionsText(options?: { messages?: Array<{ role: string; content: string }> }): Promise<string> {
  const prompt = (options?.messages ?? []).map(message => message.content).join('\n')
  if (prompt.includes('"brief"')) {
    deckCalls.push(prompt)
    return JSON.stringify({ domain: ['test'], brief: '이 장을 읽기 전에 알아 둘 것.', sections: [], recap: [], questions: [], cards: [] })
  }
  return JSON.stringify({ kind: 'term', difficulty: 2, title: '크립토필리아 미누투스', gloss: '다윈이 기재한 아주 작은 따개비 종입니다. 조개껍데기 속을 파고 들어가 삽니다.' })
}
export function closeSubscriptions() {}
