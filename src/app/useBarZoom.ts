import { useEffect } from 'react'
import { stepBarZoom, wheelZoomSteps } from '../core/barZoom'
import { announceAction } from './actionFeedback'
import { getAppPrefs, setAppPref, useAppPrefs } from './appPrefs'
import { t } from '../i18n'

export type BarSide = 'left' | 'right' | 'library'

const PREF_KEY = { left: 'leftBarZoom', right: 'rightBarZoom', library: 'libraryZoom' } as const

/** 그 바의 확대 배율(1 = 100%) */
export function useBarZoom(side: BarSide): number {
  return useAppPrefs()[PREF_KEY[side]]
}

/** 배율을 한 단계 바꾸고(저장) 알린다. 바뀐 배율 */
export function stepBarZoomPref(side: BarSide, direction: 1 | -1): number {
  const key = PREF_KEY[side]
  const next = stepBarZoom(getAppPrefs()[key], direction)
  if (next === getAppPrefs()[key]) return next
  setAppPref(key, next)
  const percent = Math.round(next * 100)
  announceAction(side === 'left' ? t('왼쪽 바 {percent}%', { percent }) : side === 'right' ? t('오른쪽 바 {percent}%', { percent }) : t('라이브러리 {percent}%', { percent }))
  return next
}

/**
 * 바 위에서 Ctrl+휠을 굴리면 그 바만 확대·축소한다. 웹뷰 전체 확대는 막는다(preventDefault).
 * 문서(PDF·Markdown)의 Ctrl+휠 확대는 그 문서 자리의 일이라 여기서 건드리지 않는다.
 */
export function attachBarZoomWheel(element: HTMLElement, side: BarSide): () => void {
  let accumulated = 0
  let timer: number | undefined
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    // 줄 단위로 오는 휠(deltaMode 1)은 한 칸을 100 으로 본다
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
    const { steps, rest } = wheelZoomSteps(accumulated, delta)
    accumulated = rest
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { accumulated = 0 }, 400)
    const direction = steps > 0 ? 1 : -1
    for (let index = 0; index < Math.abs(steps); index++) stepBarZoomPref(side, direction)
  }
  element.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    window.clearTimeout(timer)
    element.removeEventListener('wheel', onWheel)
  }
}

/** element 위의 Ctrl+휠로 side 바를 확대·축소한다. enabled 가 false 면(메모만 보기 등) 듣지 않는다 */
export function useBarZoomWheel(element: HTMLElement | null, side: BarSide, enabled = true): void {
  useEffect(() => {
    if (element === null || !enabled) return undefined
    return attachBarZoomWheel(element, side)
  }, [element, enabled, side])
}
