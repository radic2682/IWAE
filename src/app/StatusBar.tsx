import { useEffect, useRef, useState } from 'react'
import { Question } from '@phosphor-icons/react'
import { t } from '../i18n'
import { statusSessionText } from '../core/clients'
import { TOAST_SHOW_MS } from './ActionToast'
import { completeCommandLine, loadCommandHistory, pushCommandHistory, saveCommandHistory, stepCommandHistory } from './commandLine'
import type { PrefixPhase } from './usePrefixMode'
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
  /** 접두키 상태: prefix 는 다음 키를 기다리는 중, confirm 은 y/n 을 기다리는 중 */
  readonly prefixPhase?: PrefixPhase
  /** 칩을 눌렀다: 접두키를 누른 것과 같다(Ctrl+Space 가 입력기에 걸린 PC 용) */
  readonly onPrefixChip?: () => void
  /** 「화면을 닫을까요? y/n」 에 보일 글(confirm 일 때) */
  readonly confirmText?: string
  /** `:` 명령줄: 열려 있으면 상태 줄이 입력칸이 된다. prefill 은 미리 채울 글 */
  readonly commandLine?: { readonly prefill: string } | null
  readonly onRunCommand?: (line: string) => void
  readonly onCloseCommandLine?: () => void
  /** Tab 완성에 쓸 이름들 */
  readonly screenNames?: readonly string[]
  /** 세션 이름들(Tab 완성: switch-client · kill-session) */
  readonly sessionNames?: readonly string[]
  /** 이 세션에 붙은 앱 창 수. 둘 이상이면 `[논문 3장 · 앱 창 2개]` */
  readonly attached?: number
  readonly templateNames?: readonly string[]
  /** 이 화면의 칸 수(왼쪽 「칸 n개」) */
  readonly paneCount?: number
  /** 명령 팔레트 키(오른쪽 「명령」 힌트) */
  readonly paletteShortcut?: string
}

/**
 * 앱 틀 맨 아래 상태 줄(설계 3): 왼쪽 `[기본] 0:읽기* 1:비교-`(* 보는 화면, - 바로 앞 화면), 가운데 짧은 알림,
 * 오른쪽 「접두키」 칩과 「?」. 오른쪽 아래 알림 줄기의 짧은 알림(announceAction)은 상태 줄이 켜져 있으면 여기에 뜬다.
 * `:` 를 누르면 줄 전체가 명령 입력칸으로 바뀐다(CommandLineBar).
 */
export function StatusBar({
  sessionName, screens, activeId, lastId, onSelectScreen, onOpenHelp, prefixPhase = 'idle', onPrefixChip, confirmText,
  commandLine = null, onRunCommand, onCloseCommandLine, screenNames = [], sessionNames = [], attached = 1, templateNames = [], paneCount, paletteShortcut,
}: StatusBarProps) {
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
  if (commandLine !== null) {
    return (
      <CommandLineBar
        prefill={commandLine.prefill}
        screenNames={screenNames}
        sessionNames={sessionNames}
        templateNames={templateNames}
        onRun={(line) => onRunCommand?.(line)}
        onClose={() => onCloseCommandLine?.()}
      />
    )
  }
  const prefixActive = prefixPhase !== 'idle'
  const shown = prefixPhase === 'prefix' ? t('접두키 — 다음 키를 누르세요') : prefixPhase === 'confirm' ? (confirmText ?? '') : message
  return (
    <div className="status-bar" role="contentinfo" aria-label={t('상태 줄')}>
      <div className="status-bar-left">
        <span className="status-bar-session" title={t('세션')}>{statusSessionText(sessionName, attached)}</span>
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
      <div className="status-bar-message" role="status" aria-live="polite" data-prefix={prefixActive ? prefixPhase : undefined}>{shown}</div>
      <div className="status-bar-right">
        {paletteShortcut === undefined ? null : <span className="status-bar-hint">{t('{shortcut} 명령', { shortcut: paletteShortcut })}</span>}
        <button
          type="button"
          className="status-bar-prefix"
          data-active={prefixActive ? 'true' : 'false'}
          aria-pressed={prefixActive}
          title={t('접두키(기본 Ctrl+Space): 누르면 다음 키를 기다립니다. 입력기에 막힐 때는 여기를 누르세요')}
          onClick={onPrefixChip}
        >{t('접두키')}</button>
        <button type="button" className="status-bar-help" aria-label={t('키와 명령 보기')} title={t('키와 명령 보기')} onClick={onOpenHelp}>
          <Question size={13} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * 상태 줄이 입력칸으로 바뀐 모양(`:`): Enter 실행 · Esc 닫기 · ↑/↓ 기록(최근 50줄, 저장됨) · Tab 명령·화면 이름 완성.
 * 후보가 여럿이면 공통 앞부분까지 채우고 후보를 오른쪽에 보인다.
 */
function CommandLineBar({ prefill, screenNames, sessionNames, templateNames, onRun, onClose }: {
  readonly prefill: string
  readonly screenNames: readonly string[]
  readonly sessionNames: readonly string[]
  readonly templateNames: readonly string[]
  readonly onRun: (line: string) => void
  readonly onClose: () => void
}) {
  const [value, setValue] = useState(prefill)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const history = useRef<string[]>(loadCommandHistory())
  const cursor = useRef(history.current.length)
  const draft = useRef('')
  const input = useRef<HTMLInputElement | null>(null)
  const returnTo = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => {
    input.current?.focus()
    input.current?.setSelectionRange(prefill.length, prefill.length)
    const back = returnTo.current
    return () => { if (back instanceof HTMLElement && back.isConnected && document.activeElement === document.body) back.focus({ preventScroll: true }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번
  }, [])
  const submit = () => {
    const line = value.trim()
    if (line !== '') {
      history.current = pushCommandHistory(history.current, line)
      saveCommandHistory(history.current)
    }
    onClose()
    if (line !== '') onRun(line)
  }
  return (
    <div className="status-bar status-bar-command" role="contentinfo" aria-label={t('명령줄')}>
      <span className="status-bar-colon" aria-hidden="true">:</span>
      <input
        ref={input}
        className="status-bar-command-input"
        data-prefix-off=""
        aria-label={t('명령줄')}
        placeholder={t('명령을 치세요 (? 로 목록, Esc 로 닫기)')}
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => { setValue(event.target.value); setCandidates([]) }}
        onBlur={onClose}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
          if (event.key === 'Enter') { event.preventDefault(); submit(); return }
          if (event.key === 'Tab') {
            event.preventDefault()
            const result = completeCommandLine(value, { screenNames, sessionNames, templateNames })
            setValue(result.text)
            setCandidates(result.candidates.length > 1 ? result.candidates : [])
            return
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (cursor.current >= history.current.length) draft.current = value
            const step = stepCommandHistory(history.current, cursor.current, event.key === 'ArrowUp' ? 'up' : 'down', draft.current)
            cursor.current = step.cursor
            setValue(step.text)
            setCandidates([])
          }
        }}
      />
      {candidates.length === 0 ? null : <span className="status-bar-candidates" aria-live="polite">{candidates.join('  ')}</span>}
    </div>
  )
}
