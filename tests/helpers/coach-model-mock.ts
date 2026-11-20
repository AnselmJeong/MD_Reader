// Stands in for src/main/subscription-client.ts in coach smoke tests: no CLI, a fixed card.
export async function getSubscriptionStatus() { return { providers: [] } as never }
export async function subscriptionAction() {}
export async function listSubscriptionModels() { return [] }
export async function chatCompletionsStream() {}
export async function chatCompletionsText(): Promise<string> {
  return JSON.stringify({ kind: 'term', difficulty: 2, title: '크립토필리아 미누투스', gloss: '다윈이 기재한 아주 작은 따개비 종입니다. 조개껍데기 속을 파고 들어가 삽니다.' })
}
export function closeSubscriptions() {}
