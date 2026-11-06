import { useEffect } from 'react'
import { clampScroll, isNotchedWheel, smoothStep, wheelPixels } from '../core/smoothScroll'

/** 끄는 스위치: localStorage `iwae.smoothScroll` = `off` */
const SWITCH_KEY = 'iwae.smoothScroll'

function smoothScrollOff(): boolean {
  try {
    if (localStorage.getItem(SWITCH_KEY) === 'off') return true
  } catch { /* 저장소를 못 써도 켠 채로 둔다 */ }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 이 방향으로 더 굴릴 수 있는 가장 가까운 세로 스크롤 상자 */
function scrollTargetOf(start: Element | null, delta: number): HTMLElement | null {
  for (let element = start; element !== null; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue
    if (element.scrollHeight <= element.clientHeight + 1) continue
    const overflow = getComputedStyle(element).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') continue
    const max = element.scrollHeight - element.clientHeight
    if (delta > 0 ? element.scrollTop < max - 1 : element.scrollTop > 0) return element
  }
  return null
}

interface Glide {
  pos: number
  target: number
  last: number
  frame: number
}

/**
 * 앱 전체의 마우스 휠을 부드럽게 굴린다(브라우저의 부드러운 스크롤처럼).
 * Ctrl·Shift·Alt 휠(배율·가로), 터치패드, 이미 다른 곳에서 막은 휠은 그대로 둔다.
 * 다른 코드가 스크롤을 옮기면(쪽 이동 등) 그 자리에서 멈춘다.
 */
export function useSmoothWheel(): void {
  useEffect(() => {
    const glides = new Map<HTMLElement, Glide>()

    const tick = (element: HTMLElement) => (now: number) => {
      const glide = glides.get(element)
      if (glide === undefined) return
      // 다른 코드가 스크롤을 옮겼으면 그 뜻을 따른다
      if (Math.abs(element.scrollTop - glide.pos) > 3) {
        glides.delete(element)
        return
      }
      glide.pos = smoothStep(glide.pos, glide.target, now - glide.last)
      glide.last = now
      element.scrollTop = glide.pos
      // 끝에 닿아 더 못 가면(그새 내용이 줄었을 때 등) 멈춘다
      if (glide.pos === glide.target || Math.abs(element.scrollTop - glide.pos) > 1) {
        glides.delete(element)
        return
      }
      glide.frame = requestAnimationFrame(tick(element))
    }

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (!isNotchedWheel(event) || event.deltaY === 0) return
      const origin = event.target instanceof Element ? event.target : null
      if (origin?.closest('select, [data-native-wheel]') != null) return
      if (smoothScrollOff()) return
      const element = scrollTargetOf(origin, event.deltaY)
      if (element === null) return
      event.preventDefault()
      const max = element.scrollHeight - element.clientHeight
      const delta = wheelPixels(event, element.clientHeight)
      const glide = glides.get(element)
      if (glide !== undefined) {
        // 굴리는 중에 또 굴리면 목표를 더 민다(반대로 굴리면 지금 자리에서 돌아선다)
        const base = Math.sign(delta) === Math.sign(glide.target - glide.pos) ? glide.target : glide.pos
        glide.target = clampScroll(base + delta, max)
        return
      }
      const pos = element.scrollTop
      const next: Glide = { pos, target: clampScroll(pos + delta, max), last: performance.now(), frame: 0 }
      glides.set(element, next)
      next.frame = requestAnimationFrame(tick(element))
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      for (const glide of glides.values()) cancelAnimationFrame(glide.frame)
      glides.clear()
    }
  }, [])
}
