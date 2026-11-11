import { X } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import '../ui/notice-stack.css'

/** 한 번에 보이는 토스트 수. 넘치면 가장 오래된 것부터 걷는다 */
export const TOAST_MAX = 4
/** 뜬 채로 머무는 시간. 마우스를 올리거나 초점이 있는 동안에는 멈춘다 */
export const TOAST_SHOW_MS = 4000
/** 사라지는 움직임이 끝나기까지(CSS 의 --motion-base 와 맞춘다) */
const TOAST_LEAVE_MS = 180
/** 마우스·초점이 떠난 뒤 한 번 더 머무는 시간 */
const TOAST_LINGER_MS = 1500

interface Toast {
  readonly id: number
  readonly message: string
  readonly leaving: boolean
}

/**
 * announceAction 으로 온 짧은 알림을 쌓아 보여 준다(오른쪽 아래 알림 줄기의 위쪽).
 * 같은 글이 이미 떠 있으면 새로 쌓지 않고 머무는 시간만 늘린다.
 */
export function ActionToast() {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const timers = useRef(new Map<number, number>())
  const nextId = useRef(1)
  const toastsRef = useRef<readonly Toast[]>([])
  // 같은 틱에 여러 번 와도 서로를 보도록 목록은 ref 가 먼저 갖고, state 는 그 사본이다
  const update = useCallback((change: (current: readonly Toast[]) => readonly Toast[]) => {
    toastsRef.current = change(toastsRef.current)
    setToasts(toastsRef.current)
  }, [])

  const stopTimer = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])
  const remove = useCallback((id: number) => {
    stopTimer(id)
    update((current) => current.filter((toast) => toast.id !== id))
  }, [stopTimer, update])
  const leave = useCallback((id: number) => {
    stopTimer(id)
    update((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)))
    timers.current.set(id, window.setTimeout(() => remove(id), TOAST_LEAVE_MS))
  }, [remove, stopTimer, update])
  const hold = useCallback((id: number, ms: number) => {
    stopTimer(id)
    timers.current.set(id, window.setTimeout(() => leave(id), ms))
  }, [leave, stopTimer])

  useEffect(() => {
    const show = (event: Event) => {
      const message = String((event as CustomEvent<string>).detail ?? '')
      if (message === '') return
      const same = toastsRef.current.find((toast) => toast.message === message && !toast.leaving)
      if (same !== undefined) { hold(same.id, TOAST_SHOW_MS); return }
      const id = nextId.current++
      update((current) => {
        const kept = current.filter((toast) => !toast.leaving)
        const dropped = kept.slice(0, Math.max(0, kept.length + 1 - TOAST_MAX))
        for (const toast of dropped) stopTimer(toast.id)
        return [...kept.slice(dropped.length), { id, message, leaving: false }]
      })
      hold(id, TOAST_SHOW_MS)
    }
    window.addEventListener('iwae:action-feedback', show)
    const running = timers.current
    return () => {
      window.removeEventListener('iwae:action-feedback', show)
      for (const timer of running.values()) window.clearTimeout(timer)
      running.clear()
    }
  }, [hold, stopTimer, update])

  return (
    <div className="notice-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="notice-toast"
          data-leaving={toast.leaving}
          onPointerEnter={() => { if (!toast.leaving) stopTimer(toast.id) }}
          onPointerLeave={() => { if (!toast.leaving) hold(toast.id, TOAST_LINGER_MS) }}
          onFocus={() => { if (!toast.leaving) stopTimer(toast.id) }}
          onBlur={() => { if (!toast.leaving) hold(toast.id, TOAST_LINGER_MS) }}
        >
          <span className="notice-toast-text">{toast.message}</span>
          <button type="button" className="notice-close" aria-label={t('알림 닫기')} onClick={() => leave(toast.id)}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
