import { BookOpen, Sparkles, Brain, Globe, Check, FolderOpen, GraduationCap } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldDescription } from './ui/field'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Frame, FrameHeader, FrameTitle, FramePanel } from './reui/frame'
import { Badge } from './reui/badge'

import { SubscriptionAccounts } from './SubscriptionAccounts'
import { modelLabel } from '../../../shared/subscription'
import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { useChatStore } from '../store/useChatStore'
import { filterSubscriptionModels } from '../utils/subscription-model-filter'
import type { AgentMemoryStatus, AiProviderStatus } from '../global'
import { DEFAULT_COACH_SETTINGS, type CoachSettings, type CoachUsage } from '../../../shared/coach'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [section, setSection] = useState('appearance')
  const [providerError, setProviderError] = useState('')
  const [providerSaved, setProviderSaved] = useState(false)
  const [providerSaving, setProviderSaving] = useState(false)
  const [fonts, setFonts] = useState<string[]>([])
  const [fontError, setFontError] = useState('')
  useEffect(() => { void window.api.fonts.listKorean().then(setFonts).catch(() => setFontError('설치된 글꼴을 불러올 수 없습니다.')) }, [])
  const [memorySaving, setMemorySaving] = useState(false)
  const [coachSettings, setCoachSettings] = useState<CoachSettings>(DEFAULT_COACH_SETTINGS)
  const [coachUsage, setCoachUsage] = useState<CoachUsage | null>(null)
  useEffect(() => {
    void window.api.coach.getSettings().then(setCoachSettings).catch(() => {})
    void window.api.coach.getUsage().then(setCoachUsage).catch(() => {})
  }, [])
  const updateCoach = (partial: Partial<CoachSettings>) => {
    setCoachSettings(current => ({ ...current, ...partial }))
    void window.api.coach.setSettings(partial).then(setCoachSettings).catch(() => {})
  }
  const [memoryError, setMemoryError] = useState('')
  const [clearMemoryKey, setClearMemoryKey] = useState(false)
  const [memoryStatus, setMemoryStatus] = useState<AgentMemoryStatus | null>(null)
  const [aiProviderStatus, setAiProviderStatus] = useState<AiProviderStatus | null>(null)
  const [aiProviderDraft, setAiProviderDraft] = useState({
    tinyfishApiKey: '',
    braveApiKey: '',
    clearBraveApiKey: false,
    webSearchEnabled: true
  })
  const [memoryDraft, setMemoryDraft] = useState({
    enabled: true,
    extractionEnabled: true,
    runtimeInjectionEnabled: true,
    hindsightBaseUrl: 'https://hindsight.ecoplay.cloud',
    hindsightApiKey: '',
    hindsightBankId: 'MD-reader',
    extractorModel: ''
  })
  const {
    theme,
    fontSize,
    aiSidebarFontSize,
    lineHeight,
    contentWidth, readerFontFamily, setReaderFontFamily,
    setTheme,
    setFontSize,
    setAiSidebarFontSize,
    setLineHeight,
    setContentWidth
  } = useSettingsStore()
  const {
    systemPrompt,
    setSystemPrompt,
    selectedModel,
    availableModels,
    setSelectedModel,
    setAvailableModels
  } = useChatStore()

  // Refresh models when opening settings.
  useEffect(() => {
    const refreshModels = async () => {
      try {
        const models = await window.api.ai.listModels()
        const modelNames = filterSubscriptionModels(models.map((m) => m.name))
        setAvailableModels(modelNames)
      } catch (e) {
        console.error('Failed to refresh models in settings:', e)
      }
    }
    refreshModels()
  }, [setAvailableModels])

  useEffect(() => {
    const loadMemoryStatus = async () => {
      try {
        const status = await window.api.agentMemory.status()
        setMemoryStatus(status)
        setMemoryDraft((draft) => ({
          ...draft,
          enabled: status.settings.enabled ?? draft.enabled,
          extractionEnabled: status.settings.extractionEnabled ?? draft.extractionEnabled,
          runtimeInjectionEnabled: status.settings.runtimeInjectionEnabled ?? draft.runtimeInjectionEnabled,
          hindsightBaseUrl: status.settings.hindsightBaseUrl ?? draft.hindsightBaseUrl,
          hindsightBankId: status.settings.hindsightBankId ?? draft.hindsightBankId,
          extractorModel: status.settings.extractorModel ?? draft.extractorModel
        }))
      } catch (error) {
        console.error('Failed to load agent memory status:', error)
      }
    }
    loadMemoryStatus()
  }, [])

  useEffect(() => {
    const loadAiProviderStatus = async () => {
      try {
        const status = await window.api.aiProvider.status()
        setAiProviderStatus(status)
        setAiProviderDraft((draft) => ({
          ...draft,
          webSearchEnabled: status.webSearchEnabled
        }))
      } catch (error) {
        console.error('Failed to load AI provider status:', error)
      }
    }
    loadAiProviderStatus()
  }, [])

  const saveMemorySettings = async () => {
    setMemorySaving(true)
    setMemoryError('')
    try {
      const status = await window.api.agentMemory.updateSettings({
        enabled: memoryDraft.enabled,
        extractionEnabled: memoryDraft.extractionEnabled,
        runtimeInjectionEnabled: memoryDraft.runtimeInjectionEnabled,
        hindsightBaseUrl: memoryDraft.hindsightBaseUrl.trim(),
        hindsightApiKey: clearMemoryKey ? '' : memoryDraft.hindsightApiKey.trim() || undefined,
        hindsightBankId: memoryDraft.hindsightBankId.trim(),
        extractorModel: memoryDraft.extractorModel.trim()
      })
      setMemoryStatus(status)
      setMemoryDraft((draft) => ({ ...draft, hindsightApiKey: '' }))
      setClearMemoryKey(false)
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Failed to connect to Hindsight')
    } finally {
      setMemorySaving(false)
    }
  }

  const saveAiProviderSettings = async () => {
    setProviderError(''); setProviderSaving(true); setProviderSaved(false)
    try {
      const status = await window.api.aiProvider.updateSettings({
        tinyfishApiKey: aiProviderDraft.tinyfishApiKey.trim() || undefined,
        braveApiKey: aiProviderDraft.braveApiKey.trim() || undefined,
        clearBraveApiKey: aiProviderDraft.clearBraveApiKey || undefined,
        webSearchEnabled: aiProviderDraft.webSearchEnabled
      })
      setAiProviderStatus(status)
      setProviderSaved(true)
      setAiProviderDraft((draft) => ({ ...draft, tinyfishApiKey: '', braveApiKey: '', clearBraveApiKey: false }))
      const models = await window.api.ai.listModels()
      const modelNames = filterSubscriptionModels(models.map((m) => m.name))
      setAvailableModels(modelNames)
      if (!selectedModel && modelNames.length > 0) {
        setSelectedModel(modelNames[0])
      }
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : '검색 설정을 저장하지 못했습니다.')
    } finally { setProviderSaving(false) }
  }

  const navigate = (id: string) => {
    setSection(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="settings-dialog" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('button[title="Settings"]')?.focus() }}>
      <DialogHeader className="settings-heading"><DialogTitle>설정</DialogTitle><DialogDescription>읽기 환경과 AI 연결을 한곳에서 관리하세요.</DialogDescription></DialogHeader>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="설정 항목">
          {[{ id: 'appearance', label: '읽기 환경', Icon: BookOpen }, { id: 'ai', label: 'AI 계정', Icon: Sparkles }, { id: 'search', label: '웹 검색', Icon: Globe }, { id: 'memory', label: '메모리', Icon: Brain }, { id: 'coach', label: '독서 코치', Icon: GraduationCap }].map(({id, label, Icon}) => <button key={id} onClick={() => navigate(id)} aria-current={section === id}><Icon />{label}</button>)}
        </nav>
        <div className="settings-content">
          <section id="settings-appearance" className="settings-section">
            <Frame className="settings-frame"><FrameHeader><FrameTitle>읽기 환경</FrameTitle></FrameHeader><FramePanel>
              <FieldGroup>
                <Field><FieldLabel>테마</FieldLabel><ToggleGroup type="single" value={theme} onValueChange={value => { if (value) setTheme(value as typeof theme) }} aria-label="테마">
                  <ToggleGroupItem value="light">라이트</ToggleGroupItem><ToggleGroupItem value="sepia">세피아</ToggleGroupItem><ToggleGroupItem value="dark">다크</ToggleGroupItem>
                </ToggleGroup></Field>
                <Field><FieldLabel htmlFor="reader-font">본문 글꼴</FieldLabel><select id="reader-font" value={readerFontFamily} onChange={e => setReaderFontFamily(e.target.value)}><option value="">기본 글꼴</option>{readerFontFamily && !fonts.includes(readerFontFamily) && <option value={readerFontFamily}>{readerFontFamily}</option>}{fonts.map(font => <option key={font}>{font}</option>)}</select>{fontError && <FieldDescription>{fontError}</FieldDescription>}</Field>
                <SettingRange id="font-size" label="본문 크기" value={fontSize} min={14} max={22} onChange={setFontSize} unit="px" />
                <SettingRange id="line-height" label="줄 간격" value={lineHeight} min={1.4} max={2.2} step={.05} onChange={setLineHeight} />
                <SettingRange id="content-width" label="본문 너비" value={contentWidth} min={52} max={82} step={2} onChange={setContentWidth} />
              </FieldGroup>
              <div className="settings-preview" style={{fontFamily: readerFontFamily || undefined, fontSize, lineHeight}}><Badge variant="secondary">미리보기</Badge><p className="mt-3">지식은 서로 연결될 때 더 깊은 의미를 가집니다. 편안한 글꼴과 여백으로 문장에 집중해 보세요.</p></div>
            </FramePanel></Frame>
          </section>
          <section id="settings-ai" className="settings-section">
            <Frame className="settings-frame"><FrameHeader><FrameTitle>AI 계정과 대화</FrameTitle></FrameHeader><FramePanel>
              <FieldGroup>
                <SubscriptionAccounts onModelsChanged={async () => { const models = await window.api.ai.listModels(); setAvailableModels(filterSubscriptionModels(models.map(model => model.name))) }} />
                <Field><FieldLabel htmlFor="default-model">기본 모델</FieldLabel><select id="default-model" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>{!selectedModel && <option value="">모델 선택</option>}{availableModels.length === 0 && <option value="">연결된 모델이 없습니다</option>}{availableModels.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}</select></Field>
                <SettingRange id="ai-font-size" label="AI 패널 글자 크기" value={aiSidebarFontSize} min={12} max={20} onChange={setAiSidebarFontSize} unit="px" />
                <Field><FieldLabel htmlFor="system-prompt">시스템 프롬프트</FieldLabel><Textarea id="system-prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={5} /></Field>
              </FieldGroup>
            </FramePanel></Frame>
          </section>
          <section id="settings-search" className="settings-section">
            <Frame className="settings-frame"><FrameHeader><FrameTitle>웹 검색</FrameTitle></FrameHeader><FramePanel>
              <FieldGroup>
                <Field orientation="horizontal"><FieldLabel htmlFor="allow-search">TinyFish 검색 허용</FieldLabel><input id="allow-search" type="checkbox" checked={aiProviderDraft.webSearchEnabled} onChange={e => setAiProviderDraft(d => ({...d, webSearchEnabled: e.target.checked}))} /></Field>
                <FieldDescription>검색은 기본적으로 꺼져 있습니다. AI 입력창에서 질문별로 켤 수 있습니다.</FieldDescription>
                <div>
                  <label htmlFor="tinyfish-api-key" className="mb-2 block text-sm">TinyFish Search API Key {aiProviderStatus?.hasTinyfishApiKey ? '(saved)' : ''}</label>
                  <Input id="tinyfish-api-key" type="password" autoComplete="off" value={aiProviderDraft.tinyfishApiKey} onChange={e => { setAiProviderDraft(d => ({...d, tinyfishApiKey: e.target.value})); setProviderSaved(false) }} placeholder={aiProviderStatus?.hasTinyfishApiKey ? '비워 두면 저장된 키를 유지합니다' : '웹 검색용 API 키'} />
                </div>
                <div>
                  <label htmlFor="brave-api-key" className="mb-2 block text-sm">Brave Search API Key (그림 검색) {aiProviderStatus?.hasBraveApiKey ? (aiProviderStatus.braveApiKeySource === 'env' ? '(env)' : '(saved)') : ''}</label>
                  <Input id="brave-api-key" type="password" autoComplete="off" value={aiProviderDraft.braveApiKey} onChange={e => { setAiProviderDraft(d => ({...d, braveApiKey: e.target.value, clearBraveApiKey: false})); setProviderSaved(false) }} placeholder={aiProviderStatus?.hasBraveApiKey ? '비워 두면 저장된 키를 유지합니다' : '코치 카드 그림 검색용 API 키'} />
                  <FieldDescription>독서 코치 카드의 그림은 먼저 Wikipedia(TinyFish)에서 찾고, 없으면 Brave 이미지 검색으로 찾습니다.</FieldDescription>
                </div>
                {aiProviderStatus?.braveApiKeySource === 'saved' && <Field orientation="horizontal"><input id="clear-brave-key" type="checkbox" checked={aiProviderDraft.clearBraveApiKey} onChange={e => { setAiProviderDraft(d => ({...d, clearBraveApiKey: e.target.checked})); setProviderSaved(false) }} /><FieldLabel htmlFor="clear-brave-key">저장된 Brave 키 지우기</FieldLabel></Field>}
                <div className="flex items-center gap-3"><Button onClick={saveAiProviderSettings} disabled={providerSaving}>{providerSaving ? '저장 중…' : '검색 설정 저장'}</Button>{providerSaved && <Badge variant="primary-light"><Check />저장됨</Badge>}</div>
                {providerError && <p role="alert" className="text-sm text-destructive">{providerError}</p>}
              </FieldGroup>
            </FramePanel></Frame>
          </section>
          <section id="settings-memory" className="settings-section">
            <Frame className="settings-frame"><FrameHeader><FrameTitle>Hindsight 메모리</FrameTitle></FrameHeader><FramePanel>
              <FieldGroup>
                <Field orientation="horizontal"><FieldLabel htmlFor="memory-enable">메모리 사용</FieldLabel><input id="memory-enable" type="checkbox" checked={memoryDraft.enabled} onChange={e => setMemoryDraft(d => ({...d, enabled: e.target.checked}))} /></Field>
                <Field orientation="horizontal"><FieldLabel htmlFor="memory-extract">대화 종료 시 인사이트 추출</FieldLabel><input id="memory-extract" type="checkbox" checked={memoryDraft.extractionEnabled} onChange={e => setMemoryDraft(d => ({...d, extractionEnabled: e.target.checked}))} /></Field>
                <Field orientation="horizontal"><FieldLabel htmlFor="memory-chat">대화에 메모리 활용</FieldLabel><input id="memory-chat" type="checkbox" checked={memoryDraft.runtimeInjectionEnabled} onChange={e => setMemoryDraft(d => ({...d, runtimeInjectionEnabled: e.target.checked}))} /></Field>
                <Field><FieldLabel htmlFor="memory-server">Hindsight 서버 주소</FieldLabel><Input id="memory-server" aria-label="Hindsight Server URL" value={memoryDraft.hindsightBaseUrl} onChange={e => setMemoryDraft(d => ({...d, hindsightBaseUrl: e.target.value}))} placeholder="https://hindsight.ecoplay.cloud" /><FieldDescription>/dashboard 없이 서버 주소를 입력하세요.</FieldDescription></Field>
                <Field><FieldLabel htmlFor="memory-key">Hindsight API Key {memoryStatus?.settings.hasHindsightApiKey ? '(saved)' : ''}</FieldLabel><Input id="memory-key" type="password" autoComplete="off" value={memoryDraft.hindsightApiKey} onChange={e => setMemoryDraft(d => ({...d, hindsightApiKey: e.target.value}))} placeholder={memoryStatus?.settings.hasHindsightApiKey ? '비워 두면 저장된 키를 유지합니다' : '인증 서버에서만 필요합니다'} /></Field>
                <Field orientation="horizontal"><input id="clear-memory-key" type="checkbox" checked={clearMemoryKey} onChange={e => setClearMemoryKey(e.target.checked)} /><FieldLabel htmlFor="clear-memory-key">저장된 API 키 지우기</FieldLabel></Field>
                <Field><FieldLabel htmlFor="memory-bank">메모리 뱅크</FieldLabel><Input id="memory-bank" value={memoryDraft.hindsightBankId} onChange={e => setMemoryDraft(d => ({...d, hindsightBankId: e.target.value}))} /></Field>
                <Field><FieldLabel htmlFor="extract-model">추출 모델</FieldLabel><select id="extract-model" value={memoryDraft.extractorModel} onChange={e => setMemoryDraft(d => ({...d, extractorModel: e.target.value}))}><option value="">대화 모델 사용</option>{availableModels.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}</select><FieldDescription>연결 시 뱅크가 없으면 생성합니다. 선별된 인사이트를 저장하며 USER.md와 SOUL.md는 로컬에 유지됩니다.</FieldDescription></Field>
                {memoryError && <p role="alert" className="text-sm text-destructive">{memoryError}</p>}
                <p role="status" className="text-xs text-muted-foreground">{memoryStatus?.hindsight.ok ? 'Hindsight connected' : memoryStatus?.hindsight.error || 'Hindsight 연결 상태 확인 전'}</p>
                <div className="flex gap-2"><Button variant="outline" onClick={() => void window.api.agentMemory.openFolder()}><FolderOpen data-icon="inline-start" />폴더</Button><Button onClick={saveMemorySettings} disabled={memorySaving}>{memorySaving ? 'Connecting…' : 'Save & Connect'}</Button></div>
              </FieldGroup>
            </FramePanel></Frame>
          </section>
          <section id="settings-coach" className="settings-section">
            <Frame className="settings-frame"><FrameHeader><FrameTitle>독서 코치 (EPUB)</FrameTitle></FrameHeader><FramePanel>
              <FieldGroup>
                <Field orientation="horizontal"><FieldLabel htmlFor="coach-ask">새 책을 열 때 묻기</FieldLabel><input id="coach-ask" type="checkbox" checked={coachSettings.askOnOpen} onChange={e => updateCoach({ askOnOpen: e.target.checked })} /></Field>
                <FieldDescription>끄면 새 책은 코치 없이 열립니다. 읽기 화면 아래 "코치" 버튼으로 언제든 켤 수 있습니다.</FieldDescription>
                <Field><FieldLabel htmlFor="coach-model">코치 모델</FieldLabel><select id="coach-model" value={coachSettings.coachModel} onChange={e => updateCoach({ coachModel: e.target.value })}><option value="auto">자동 (Claude는 Sonnet, Codex는 GPT-6.2 Sol)</option>{availableModels.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}</select><FieldDescription>장마다 한 번, 백그라운드에서 카드 묶음을 만들 때 씁니다.</FieldDescription></Field>
                <Field orientation="horizontal" className="settings-row"><FieldLabel htmlFor="coach-limit">하루 장 준비 한도</FieldLabel><Input id="coach-limit" type="number" min={0} max={200} value={coachSettings.dailyLimit} onChange={e => updateCoach({ dailyLimit: Number(e.target.value) })} className="w-24" /></Field>
                <Field orientation="horizontal" className="settings-row"><FieldLabel htmlFor="coach-quota">구독 사용률이 이 값(%)을 넘으면 멈춤</FieldLabel><Input id="coach-quota" type="number" min={10} max={100} value={coachSettings.quotaPausePercent} onChange={e => updateCoach({ quotaPausePercent: Number(e.target.value) })} className="w-24" /></Field>
                <FieldDescription>그림은 먼저 TinyFish로 Wikipedia에서 찾고, 없으면 Brave Search 키로 찾습니다. 카드의 &quot;그림 바꾸기&quot;로 후보 중에서 고를 수 있습니다. 외부로는 검색어만 나갑니다.</FieldDescription>
                {coachUsage && <p role="status" className="text-xs text-muted-foreground">오늘 코치 호출 {coachUsage.calls}회 · 캐시에서 해결 {coachUsage.cacheHits}회{coachUsage.failures ? ` · 실패 ${coachUsage.failures}회` : ''}</p>}
              </FieldGroup>
            </FramePanel></Frame>
          </section>
        </div>
      </div>
      <footer className="settings-footer"><p>읽기·대화 환경은 변경 즉시 저장됩니다.</p><Button onClick={onClose}>Done</Button></footer>
    </DialogContent>
  </Dialog>
}

function SettingRange({ id, label, value, min, max, step = 1, unit = '', onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <Field orientation="horizontal" className="settings-row"><FieldLabel htmlFor={id}>{label}</FieldLabel><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /><output htmlFor={id}>{step < 1 ? value.toFixed(2) : value}{unit}</output></Field>
}
