import { Button } from './ui/button'
import { useEffect, useRef, useState } from 'react'
import type { SubscriptionProvider, SubscriptionStatus } from '../../../shared/subscription'

export function SubscriptionAccounts({ onModelsChanged }: { onModelsChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const onChanged = useRef(onModelsChanged)
  onChanged.current = onModelsChanged
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let previous = ''
    const refresh = async () => {
      try {
        const next = await window.api.subscriptions.status()
        if (!active) return
        setStatus(next)
        const states = `${next.codex.state}:${next.claude.state}`
        if (previous && states !== previous) await onChanged.current()
        previous = states
      } catch (error) { if (active) setError(String(error)) }
      if (active) timer = setTimeout(refresh, 4000)
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  const act = async (provider: SubscriptionProvider, action: 'login' | 'cancelLogin' | 'logout') => {
    setBusy(true); setError('')
    try {
      await window.api.subscriptions.action(provider, action)
      setStatus(await window.api.subscriptions.status())
      await onChanged.current()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <p className="text-xs text-on-surface-muted">GPT와 Claude 구독 계정으로 연결합니다. 계정 한도는 다른 앱과 공유하며, 유료 API로 자동 전환하지 않습니다.</p>
    {(['codex', 'claude'] as const).map(provider => {
      const account = status?.[provider]
      const labels = { connected: '연결됨', signedOut: '로그인 필요', signingIn: '브라우저에서 로그인 진행 중', unavailable: 'CLI 설치 필요', error: '연결 확인 필요' }
      return <div key={provider} className="rounded-md border border-border p-3 space-y-2">
        <div className="text-sm font-medium text-on-surface">{provider === 'codex' ? 'GPT · ChatGPT subscription' : 'Claude · Claude subscription'}</div>
        <p className="text-xs text-on-surface-muted">{account ? labels[account.state] : '연결 확인 중…'}{account?.plan ? ` · ${account.plan}` : ''}{account?.cliVersion ? ` · CLI ${account.cliVersion}` : ''}</p>
        {account?.error && <p role="status" className="text-xs text-red-600">{account.error}</p>}
        {provider === 'codex' && status?.codex.state === 'connected' && <div className="text-xs text-on-surface-muted">
          {status.codex.ordinaryUsageAllowed === null ? '사용 가능 한도를 확인할 수 없습니다.' : status.codex.ordinaryUsageAllowed ? '구독 사용 가능' : '구독 한도 도달'}
          {status.codex.quotas.map(quota => <div key={quota.id}>{quota.name}: {[quota.primary, quota.secondary].filter(w => w !== null).map(w => `${Math.max(0, 100 - w.usedPercent)}% 남음${w.resetsAt ? ` · ${new Date(w.resetsAt * 1000).toLocaleString()} 초기화` : ''}`).join(' / ')}</div>)}
        </div>}
        {provider === 'claude' && account?.state === 'connected' && <p className="text-xs text-on-surface-muted">{status?.claude.quota?.status === 'rejected' ? '구독 사용 한도에 도달했습니다.' : '사용 한도는 Claude가 응답할 때 확인합니다. 추가 사용 과금 설정은 Claude 계정에서 관리됩니다.'}</p>}
        <div className="flex gap-2">
          {account?.state === 'signingIn' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(provider, 'cancelLogin')}>로그인 취소</Button>
            : <Button size="sm" disabled={busy || !account} onClick={() => void act(provider, account?.state === 'connected' ? 'logout' : 'login')}>{account?.state === 'connected' ? '로그아웃' : '구독 계정 로그인'}</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setError('')
            try { setStatus(await window.api.subscriptions.status()); await onChanged.current() }
            catch (error) { setError(String(error)) }
            finally { setBusy(false) }
          }}>새로고침</Button>
        </div>
      </div>
    })}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>
}
