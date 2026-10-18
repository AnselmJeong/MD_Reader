// Composer adapted from ReUI c-input-group-18 (MIT); connected to MD Reader's existing chat store.
import { ArrowUp, Brain, Globe, Paperclip, Square, Quote, X, BookOpen } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '../ui/input-group'
import { Frame, FrameHeader } from '../reui/frame'
import { Button } from '../ui/button'
import { useDocumentStore } from '../../store/useDocumentStore'
import { useRef, useEffect, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'

import { ChatImages } from './ChatImages'
import { readChatImage } from './utils/chatImageFiles'
import { MAX_CHAT_IMAGES, imageModelWarning } from '../../../../shared/chat-images'
import { THINKING_LEVELS, effectiveThinkingLevel, normalizeThinkingLevel } from '../../../../shared/chat-request-options'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const fileName = useDocumentStore(s => s.fileName)
  const input = useChatStore((s) => s.inputDraft)
  const setInputDraft = useChatStore((s) => s.setInputDraft)
  const webSearch = useChatStore(s => s.webSearch)
  const setWebSearch = useChatStore(s => s.setWebSearch)
  const thinkingLevel = useChatStore(s => s.thinkingLevel)
  const setThinkingLevel = useChatStore(s => s.setThinkingLevel)
  const pendingQuotedText = useChatStore((s) => s.pendingQuotedText)
  const setPendingQuotedText = useChatStore((s) => s.setPendingQuotedText)
  const focusInputRequest = useChatStore((s) => s.focusInputRequest)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const pendingImages = useChatStore(s => s.pendingImages)
  const setPendingImages = useChatStore(s => s.setPendingImages)
  const selectedModel = useChatStore(s => s.selectedModel)
  const modelVision = useChatStore(s => s.modelVision)
  const isCheckingVision = useChatStore(s => s.isCheckingVision)
  const isPreparingMessage = useChatStore(s => s.isPreparingMessage)
  const sendWarning = useChatStore(s => s.sendWarning)
  const hasHistoricalImages = useChatStore(s => s.messages.some(message => Boolean(message.images?.length)))
  const refreshModelVision = useChatStore(s => s.refreshModelVision)
  const fileInput = useRef<HTMLInputElement>(null)
  const reading = useRef(false)
  const [isReading, setIsReading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const hasImages = pendingImages.length > 0 || hasHistoricalImages
  const vision = modelVision?.model === selectedModel ? modelVision.vision : 'unknown'
  const warning = hasImages && selectedModel ? imageModelWarning(selectedModel, vision, hasHistoricalImages) : ''
  const blocked = disabled || isPreparingMessage || isReading || (hasImages && (isCheckingVision || vision === 'unsupported'))

  useEffect(() => {
    if (hasImages && selectedModel) void refreshModelVision()
  }, [hasImages, selectedModel, refreshModelVision])

  const attachFiles = async (files: File[]) => {
    if (!files.length || reading.current || disabled || isPreparingMessage) return
    const before = useChatStore.getState()
    setImageError('')
    if (before.pendingImages.length + files.length > MAX_CHAT_IMAGES) {
      setImageError(`이미지는 한 질문에 최대 ${MAX_CHAT_IMAGES}장까지 첨부할 수 있습니다.`)
      return
    }
    reading.current = true
    setIsReading(true)
    try {
      const images = await Promise.all(files.map(readChatImage))
      const current = useChatStore.getState()
      if (current.currentContextMeta !== before.currentContextMeta || current.currentSessionId !== before.currentSessionId || current.messages !== before.messages) return
      setPendingImages([...current.pendingImages, ...images])
      textareaRef.current?.focus()
    } catch (error) { setImageError(error instanceof Error ? error.message : '이미지를 읽을 수 없습니다.') }
    finally { reading.current = false; setIsReading(false) }
  }

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = input.trim() ? Math.min(ta.scrollHeight, 180) + 'px' : '86px'
  }, [input])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || ta.disabled) return
    ta.focus({ preventScroll: true })
    const end = ta.value.length
    ta.setSelectionRange(end, end)
  }, [focusInputRequest])

  const handleSend = () => {
    if ((!input.trim() && !pendingImages.length) || blocked) return
    onSend(input.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`chat-composer ${isDragging ? 'chat-composer-dragging' : ''}`}
      onPaste={event => {
        const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => Boolean(file))
        if (files.length) { event.preventDefault(); event.stopPropagation(); void attachFiles(files) }
      }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setIsDragging(true) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false) }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setIsDragging(false); void attachFiles(Array.from(event.dataTransfer.files)) }}>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { void attachFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      <Frame className="composer-frame" spacing="sm">
        {(pendingQuotedText || fileName) && <FrameHeader className="composer-context">
          {pendingQuotedText ? <Quote /> : <BookOpen />}
          <span title={pendingQuotedText || fileName || ''}>{pendingQuotedText || fileName}</span>
          {pendingQuotedText && <Button variant="ghost" size="icon-xs" onClick={() => setPendingQuotedText(null)} title="Remove selected passage" aria-label="선택 문단 제거"><X /></Button>}
        </FrameHeader>}
        <InputGroup className="composer-input-group" aria-label="AI 질문 입력">
          <InputGroupTextarea ref={textareaRef} value={input} onChange={e => setInputDraft(e.target.value)} onKeyDown={handleKeyDown}
            aria-label="메시지 입력"
            placeholder={!selectedModel ? '설정에서 AI 모델을 연결해 주세요' : isStreaming ? '답변을 작성하고 있습니다…' : '무엇이 궁금한가요?'}
            disabled={disabled || isPreparingMessage} rows={2} />
          {Boolean(pendingImages.length) && <div className="composer-extras"><ChatImages images={pendingImages} onRemove={isPreparingMessage ? undefined : id => setPendingImages(pendingImages.filter(image => image.id !== id))} /></div>}
          <InputGroupAddon align="block-end" className="composer-tools">
            <InputGroupButton size="icon-sm" aria-label="이미지 첨부" title="이미지 첨부 · 스크린샷 붙여넣기 ⌘V" onClick={() => fileInput.current?.click()} disabled={disabled || isReading || isPreparingMessage || pendingImages.length >= MAX_CHAT_IMAGES}><Paperclip /></InputGroupButton>
            <label className="composer-thinking"><Brain /><select aria-label="Thinking 수준" value={thinkingLevel} onChange={event => setThinkingLevel(normalizeThinkingLevel(event.target.value))} disabled={disabled || isPreparingMessage} title="이번 질문의 사고 수준 · 모델에 따라 지원 범위가 다릅니다">
              {THINKING_LEVELS.map(level => <option key={level} value={level}>{level === 'none' ? 'Think · Off' : level[0].toUpperCase() + level.slice(1)}</option>)}
            </select></label>
            <InputGroupButton size="sm" aria-label="웹 검색" aria-pressed={webSearch} disabled={disabled || isPreparingMessage} onClick={() => setWebSearch(!webSearch)} variant={webSearch ? 'secondary' : 'ghost'} title="이번 질문에 웹 검색 사용 · Settings에서 TinyFish API 키 설정 필요"><Globe data-icon="inline-start" />{webSearch ? '검색 켬' : '검색'}</InputGroupButton>
            {isStreaming ? <InputGroupButton className="composer-send" size="icon-sm" variant="default" onClick={() => void stopStreaming()} title="Stop response (Esc)" aria-label="응답 중지"><Square /></InputGroupButton>
              : <InputGroupButton className="composer-send" size="icon-sm" variant="default" onClick={handleSend} aria-label="질문 보내기" disabled={blocked || (!input.trim() && !pendingImages.length)}><ArrowUp /></InputGroupButton>}
          </InputGroupAddon>
        </InputGroup>
      </Frame>
      {(isCheckingVision || isReading || isPreparingMessage) && <p className="chat-image-hint" role="status">{isReading ? '이미지 준비 중…' : '모델의 이미지 지원 여부 확인 중…'}</p>}
      {!isCheckingVision && (imageError || sendWarning || warning) && <p className="chat-image-warning" role="alert">{imageError || sendWarning || warning}</p>}
      {effectiveThinkingLevel(selectedModel, thinkingLevel) !== thinkingLevel && <p className="chat-image-hint" role="status">이 모델은 Thinking을 끌 수 없어 None 대신 Low로 요청합니다.</p>}
      <details className="composer-help"><summary>입력 도움말 · Enter로 보내기</summary><p>줄바꿈 Shift+Enter · 스크린샷 붙여넣기 ⌘V · 이미지 최대 4장<br />검색·사고 수준은 이번 질문에만 적용되며 전송 후 Off / None으로 초기화됩니다.<br />GPT에서 지원하지 않는 사고 수준은 모델 기본값으로 적용됩니다. 답변 준비가 길어질 수 있습니다.</p></details>
    </div>
  )
}
