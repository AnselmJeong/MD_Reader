import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  COACH_FAMILIARITY, COACH_PROACTIVITY, COACH_PURPOSES, COACH_REQUEST_EXAMPLES,
  type CoachPreferences
} from '../../../../shared/coach'
import { initialPreferences, useCoachStore } from '../../store/useCoachStore'

function Choice({ selected, onSelect, label, detail }: { selected: boolean; onSelect: () => void; label: string; detail?: string }) {
  return <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
    className={`flex w-full flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${selected ? 'border-accent bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)]' : 'border-border hover:bg-[var(--ink-3)]'}`}>
    <span className="text-[13px] font-semibold text-on-surface">{label}</span>
    {detail && <span className="text-[12px] text-on-surface-muted">{detail}</span>}
  </button>
}

/** Pre-reading intake: purpose, familiarity, proactivity and a free request. Skippable and changeable anytime. */
export function CoachIntakeDialog() {
  const open = useCoachStore(state => state.intakeOpen)
  const preferences = useCoachStore(state => state.preferences)
  const lastPreferences = useCoachStore(state => state.lastPreferences)
  const savePreferences = useCoachStore(state => state.savePreferences)
  const setIntakeOpen = useCoachStore(state => state.setIntakeOpen)
  const [draft, setDraft] = useState<CoachPreferences>(() => initialPreferences({ preferences, lastPreferences }))
  const [error, setError] = useState('')
  const [placeholder] = useState(() => COACH_REQUEST_EXAMPLES[Math.floor(Math.random() * COACH_REQUEST_EXAMPLES.length)])

  useEffect(() => { if (open) { setDraft(initialPreferences({ preferences, lastPreferences })); setError('') } }, [open, preferences, lastPreferences])

  const save = async (next: CoachPreferences) => {
    try { await savePreferences(next) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.') }
  }
  const firstTime = !preferences

  return <Dialog open={open} onOpenChange={value => {
    // Closing the first-time dialog counts as "just reading" so it is not asked again.
    if (!value) { if (firstTime) void save({ ...draft, enabled: false }); else setIntakeOpen(false) }
  }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px] ui-text" data-commentary-ui>
      <DialogHeader>
        <DialogTitle>이 책, 어떻게 도와 드릴까요?</DialogTitle>
        <DialogDescription>읽는 동안 코치가 무엇을 얼마나 보여 줄지 정합니다. 언제든 화면 아래 "코치" 버튼에서 바꿀 수 있습니다.</DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-semibold text-on-surface">1. 이 책을 어떻게 읽고 싶으세요?</legend>
        <div role="radiogroup" className="flex flex-col gap-1.5">
          {COACH_PURPOSES.map(item => <Choice key={item.id} selected={draft.purpose === item.id} label={item.label} detail={item.detail}
            onSelect={() => setDraft(value => ({ ...value, purpose: item.id }))} />)}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-semibold text-on-surface">2. 이 분야가 얼마나 익숙하세요?</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
          {COACH_FAMILIARITY.map(item => <Choice key={item.id} selected={draft.familiarity === item.id} label={item.label}
            onSelect={() => setDraft(value => ({ ...value, familiarity: item.id }))} />)}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-semibold text-on-surface">3. 코치가 얼마나 나설까요?</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-1.5">
          {COACH_PROACTIVITY.map(item => <Choice key={item.id} selected={draft.proactivity === item.id || (item.id === 'suggest' && draft.proactivity === 'active')} label={item.label} detail={item.detail}
            onSelect={() => setDraft(value => ({ ...value, proactivity: item.id }))} />)}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-on-surface">4. 따로 부탁할 것이 있나요? <span className="font-normal text-on-surface-muted">(선택)</span></span>
        <Textarea rows={2} value={draft.request} maxLength={1000} placeholder={`예: ${placeholder}`}
          onChange={event => setDraft(value => ({ ...value, request: event.target.value }))} />
      </label>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button variant="ghost" onClick={() => void save({ ...draft, enabled: false })}>{firstTime || preferences?.enabled === false ? '지금은 그냥 읽을게요' : '코치 끄기'}</Button>
        <Button onClick={() => void save({ ...draft, enabled: true })}>{firstTime ? '이렇게 시작하기' : '저장'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
