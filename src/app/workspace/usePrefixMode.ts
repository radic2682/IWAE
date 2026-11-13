import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { prefixBindingFor, prefixTokenLabel, prefixTokenOf, isModifierOnly } from '../../core/prefixKeys'
import { modalDialogOpen } from '../../ui/modalOpen'
import { PREFIX_KEY_ID, effectiveKeys, eventMatches, getShortcutDef, parseCombo } from '../../core/shortcutRegistry'

/** 접두키를 누른 뒤 다음 키를 기다려 주는 시간(ms) */
export const PREFIX_TIMEOUT_MS = 2000
/** 「화면을 닫을까요? y/n」 를 기다려 주는 시간(ms) */
export const CONFIRM_TIMEOUT_MS = 6000

/** idle 평소 · prefix 다음 키를 기다림 · confirm y/n 을 기다림 */
export type PrefixPhase = 'idle' | 'prefix' | 'confirm'

export interface PrefixModeOptions {
  /** 꺼 두면(대화상자 안 등) 접두키를 받지 않는다 */
  readonly enabled?: boolean
  /** 접두키 다음 키에 걸린 명령줄을 실행한다 */
  readonly run: (line: string) => void
  /** 짧은 알림(모르는 키 등) */
  readonly announce: (message: string) => void
  /** 「화면을 닫을까요?」 에 y 를 눌렀다 */
  readonly onConfirm: () => void
  /** 칸 번호 겹침(display-panes)이 떠 있는가: 숫자 키가 그 칸으로 간다 */
  readonly numbersOpen?: boolean
  readonly onNumber?: (index: number) => void
  readonly onCloseNumbers?: () => void
  /** 사용자가 바꾼 접두키 다음 키(keys.conf 의 bind-key) */
  readonly bindings?: Readonly<Record<string, string>>
}

const swallow = (event: KeyboardEvent) => {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

/** 지금 설정된 접두키에 이 키 입력이 맞는가(한글 입력기로 key 가 바뀌어도 물리 키로 맞춘다) */
export function matchesPrefixKey(event: KeyboardEvent): boolean {
  const def = getShortcutDef(PREFIX_KEY_ID)
  if (def === undefined) return false
  return effectiveKeys(def).some((combo) => {
    const parsed = parseCombo(combo)
    return parsed !== null && eventMatches(event, parsed)
  })
}

/**
 * 단축키를 새로 정하는 중이거나 명령줄·팔레트 입력칸이면 접두키를 받지 않는다. 모달 대화상자(키 목록 · 설정 · 확인 …)가 떠 있으면 시작하지 않는다 —
 * 안 그러면 Ctrl+B 다음 % 가 뒤의 칸을 나눈다(접두키는 글 쓰는 칸 안에서도 되지만 모달의 입력은 모달의 것이다). 이미 시작한 접두키 대기는 건드리지 않는다.
 */
function blocked(event: KeyboardEvent): boolean {
  if (document.querySelector('.sk-keys-recording') !== null) return true
  if (modalDialogOpen()) return true
  const target = event.target
  return target instanceof Element && target.closest('[data-prefix-off]') !== null
}

/**
 * 접두키(기본 Ctrl+B): 글 쓰는 칸 안에서도 동작한다(tmux 와 같다). 창 맨 앞(capture)에서 받아 편집기보다 먼저 가로채고,
 * 다음 키 하나는 편집기로 보내지 않는다. 접두키를 한 번 더 누르면(Ctrl+B 의 굵게) 가로채지 않고 그대로 보낸다(send-prefix).
 * 다음 키는 `code` 로 읽는다(prefixKeys.ts). 2 초 안에 키가 없거나 Esc 면 그만둔다.
 */
export function usePrefixMode(options: PrefixModeOptions): { readonly phase: PrefixPhase; readonly enter: () => void; readonly cancel: () => void; readonly startConfirm: () => void } {
  const [phase, setPhaseState] = useState<PrefixPhase>('idle')
  const phaseRef = useRef<PrefixPhase>('idle')
  const timer = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const setPhase = useCallback((next: PrefixPhase, timeout?: number) => {
    phaseRef.current = next
    setPhaseState(next)
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
    if (next !== 'idle' && timeout !== undefined) {
      timer.current = window.setTimeout(() => { timer.current = null; phaseRef.current = 'idle'; setPhaseState('idle') }, timeout)
    }
  }, [])
  const enter = useCallback(() => setPhase('prefix', PREFIX_TIMEOUT_MS), [setPhase])
  const cancel = useCallback(() => setPhase('idle'), [setPhase])
  const startConfirm = useCallback(() => setPhase('confirm', CONFIRM_TIMEOUT_MS), [setPhase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = optionsRef.current
      if (current.enabled === false) return
      const now = phaseRef.current
      if (now === 'idle') {
        if (current.numbersOpen === true) {
          if (isModifierOnly(event)) return
          const token = prefixTokenOf(event)
          if (token !== null && /^[0-9]$/u.test(token) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            swallow(event)
            current.onNumber?.(Number(token))
            return
          }
          if (event.key === 'Escape') swallow(event)
          current.onCloseNumbers?.()
          if (event.key === 'Escape') return
        }
        if (!matchesPrefixKey(event) || blocked(event)) return
        swallow(event)
        if (!event.repeat) enter()
        return
      }
      if (isModifierOnly(event)) return
      if (now === 'prefix') {
        if (matchesPrefixKey(event)) {
          // 접두키를 한 번 더: 가로채지 않고 그대로 보낸다(send-prefix). 누르고 있어서 반복된 것이면 삼킨다
          if (event.repeat) { swallow(event); return }
          setPhase('idle')
          return
        }
        swallow(event)
        setPhase('idle')
        if (event.key === 'Escape') return
        const token = prefixTokenOf(event)
        const line = token === null ? null : prefixBindingFor(token, current.bindings)
        if (token === null || line === null) {
          current.announce(t('알 수 없는 키: {key}. ?를 누르면 목록이 나옵니다', { key: token === null ? event.key : prefixTokenLabel(token) }))
          return
        }
        current.run(line)
        return
      }
      // confirm: y 만 확인, 나머지는 모두 그만둔다
      swallow(event)
      setPhase('idle')
      if (prefixTokenOf(event) === 'y') current.onConfirm()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [enter, setPhase])

  return { phase, enter, cancel, startConfirm }
}
