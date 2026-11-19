import { preferencesPromptLine, type CoachCard, type CoachDeck, type CoachEventType, type CoachImage, type CoachReviewItem } from '../../../../../shared/coach'
import { useCoachStore } from '../../../store/useCoachStore'
import { useChatStore } from '../../../store/useChatStore'
import { useUIStore } from '../../../store/useUIStore'
import { useDocumentStore } from '../../../store/useDocumentStore'

export function recordCardEvent(type: CoachEventType, card: CoachCard, deck: Pick<CoachDeck, 'domain' | 'chapterHref' | 'documentId'>) {
  return useCoachStore.getState().record({
    documentId: deck.documentId, chapterHref: deck.chapterHref, type, domain: deck.domain,
    cardId: card.id, kind: card.kind, difficulty: card.difficulty
  })
}

async function sendToChat(prompt: string, quotedText?: string) {
  const ui = useUIStore.getState()
  if (!ui.showChat) ui.toggleChat()
  useCoachStore.getState().setPanel('chat')
  const chat = useChatStore.getState()
  if (!chat.selectedModel || chat.isStreaming || chat.isPreparingMessage) {
    chat.setInputDraft(prompt)
    if (quotedText) chat.setPendingQuotedText(quotedText)
    chat.requestInputFocus()
    return
  }
  await chat.sendMessage({ text: prompt, documentContent: useDocumentStore.getState().content, quotedText })
}

/** Spaced review: check an answer against the chapter's recap through the normal chat. */
export function askReviewAnswer(item: CoachReviewItem) {
  const recap = item.recap.length ? `\n\n이 장의 요점(코치 정리):\n${item.recap.map(line => `- ${line}`).join('\n')}` : ''
  return sendToChat(`복습 질문입니다. 《${item.bookTitle}》 ${item.chapterLabel}\n\n"${item.question}"${recap}\n\n이 질문의 핵심 답을 짧게 정리해 주세요. ${preferencesPromptLine(useCoachStore.getState().preferences)}`.trim())
}

/** "더 자세히": the expensive call happens only after this explicit click, through the normal chat. */
export async function askCoachMore(card: CoachCard, deck: CoachDeck) {
  void recordCardEvent('more', card, deck)
  const coach = useCoachStore.getState()
  const context = coach.resolveCard?.(card)
  const ui = useUIStore.getState()
  if (!ui.showChat) ui.toggleChat()
  coach.setPanel('chat')
  const chat = useChatStore.getState()
  const prompt = `"${card.title}"(본문의 "${card.quote}")을 이 책의 맥락에서 더 자세히 설명해 주세요. ${preferencesPromptLine(coach.preferences)}`.trim()
  if (!chat.selectedModel || chat.isStreaming || chat.isPreparingMessage) {
    chat.setInputDraft(prompt)
    if (context?.paragraph) chat.setPendingQuotedText(context.paragraph)
    chat.requestInputFocus()
    return
  }
  await chat.sendMessage({ text: prompt, documentContent: useDocumentStore.getState().content, quotedText: context?.paragraph || card.quote })
}

/** "EPUB에 넣기": save the card as a commentary note at its paragraph; export puts it in the book. */
export async function insertCoachCard(card: CoachCard, deck: CoachDeck, image: CoachImage | null): Promise<string> {
  const coach = useCoachStore.getState()
  const context = coach.resolveCard?.(card)
  if (!context?.anchor) throw new Error('이 카드가 붙을 문단을 화면에서 찾지 못했습니다. 해당 쪽을 연 뒤 다시 시도해 주세요.')
  const lines = [`**${card.title}**`, '', card.gloss]
  if (image?.status === 'ready' && image.dataUrl) {
    const asset = await window.api.commentary.importImageData(deck.documentId, image.dataUrl, card.title)
    lines.push('', `![${card.title}](mdr-asset:${asset.id})`)
    if (image.pageUrl) lines.push('', `그림 출처: [Wikipedia — ${image.pageTitle ?? card.title}](${image.pageUrl}) (라이선스는 원본 파일 페이지 참조)`)
  }
  lines.push('', '— AI 코치가 만든 설명')
  await window.api.commentary.save({
    documentId: deck.documentId, parentId: null, anchor: context.anchor, markdown: lines.join('\n'),
    origin: { messageId: `coach:${card.id}`, sessionId: null, model: deck.model, content: card.gloss }
  })
  void recordCardEvent('insert', card, deck)
  return '주석으로 저장했습니다. "주석을 포함한 EPUB 저장"으로 책에 넣을 수 있습니다.'
}

export function markCardKnown(card: CoachCard, deck: CoachDeck) {
  useCoachStore.getState().suppress(card.id)
  return recordCardEvent('known', card, deck)
}

export function markKindUnwanted(card: CoachCard, deck: CoachDeck) {
  useCoachStore.getState().suppress(card.id)
  return recordCardEvent('notInterested', card, deck)
}
