import { useEffect, useRef, useState } from 'react'
import { Question } from '@phosphor-icons/react'
import { t } from '../i18n'
import { TOAST_SHOW_MS } from './ActionToast'
import '../ui/status-bar.css'
import '../ui/screens.css'

export interface StatusBarScreen {
  readonly id: string
  readonly name: string
}

interface StatusBarProps {
  readonly sessionName: string
  readonly screens: readonly StatusBarScreen[]
  readonly activeId: string
  readonly lastId: string | null
  readonly onSelectScreen: (id: string) => void
  /** 「?」: 키와 명령 목록을 연다 */
  readonly onOpenHelp: () => void
  /** 접두키를 눌러 다음 키를 기다리는 중인가(단계 4 에서 켠다) */
  readonly prefixActive?: boolean
  /** 이 화면의 칸 수(왼쪽 「칸 n개」) */
  readonly paneCount?: number
  /** 명령 팔레트 키(오른쪽 「명령」 힌트) */
  readonly paletteShortcut?: string
}

/**
 * 앱 틀 맨 아래 상태 줄(설계 3): 왼쪽 `[기본] 0:읽기* 1:비교-`(* 보는 화면, - 바로 앞 화면), 가운데 짧은 알림,
 * 오른쪽 「접두키」 칩과 「?」. 오른쪽 아래 알림 줄기의 짧은 알림(announceAction)은 상태 줄이 켜져 있으면 여기에 뜬다.
 */
export function StatusBar({ sessionName, screens, activeId, lastId, onSelectScreen, onOpenHelp, prefixActive = false, paneCount, paletteShortcut }: StatusBarProps) {
  const [message, setMessage] = useState('')
  const timer = useRef<number | null>(null)
  useEffect(() => {
    const show = (event: Event) => {
      const text = String((event as CustomEvent<string>).detail ?? '')
      if (text === '') return
      setMessage(text)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { timer.current = null; setMessage('') }, TOAST_SHOW_MS)
    }
    window.addEventListener('iwae:action-feedback', show)
    return () => {
      window.removeEventListener('iwae:action-feedback', show)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])
  return (
    <div className="status-bar" role="contentinfo" aria-label={t('상태 줄')}>
      <div className="status-bar-left">
        <span className="status-bar-session" title={t('세션')}>[{sessionName}]</span>
        <span className="status-bar-screens" role="group" aria-label={t('화면')}>
          {screens.map((screen, index) => {
            const mark = screen.id === activeId ? '*' : screen.id === lastId ? '-' : ''
            return (
              <button
                key={screen.id}
                type="button"
                className={`status-bar-screen${screen.id === activeId ? ' status-bar-screen-active' : ''}`}
                aria-current={screen.id === activeId ? 'true' : undefined}
                onClick={() => onSelectScreen(screen.id)}
              >{`${index}:${screen.name}${mark}`}</button>
            )
          })}
        </span>
        {paneCount === undefined ? null : <span className="status-bar-panes">{t('칸 {n}개', { n: paneCount })}</span>}
      </div>
      <div className="status-bar-message" role="status" aria-live="polite">{message}</div>
      <div className="status-bar-right">
        {paletteShortcut === undefined ? null : <span className="status-bar-hint">{t('{shortcut} 명령', { shortcut: paletteShortcut })}</span>}
        <span className="status-bar-prefix" data-active={prefixActive ? 'true' : 'false'} title={t('접두키는 다음 단계에서 켜집니다')}>{t('접두키')}</span>
        <button type="button" className="status-bar-help" aria-label={t('키와 명령 보기')} title={t('키와 명령 보기')} onClick={onOpenHelp}>
          <Question size={13} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
