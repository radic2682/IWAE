/**
 * 앱 안에서의 끌어 놓기(PDF·Markdown 발췌 → 캔버스).
 *
 * HTML5 드래그를 쓰지 않는 이유: Windows 의 Tauri 는 탐색기에서 파일을 끌어 넣는 것을 받으려고
 * 창의 끌어 놓기를 가로챈다(dragDropEnabled). 그러면 웹뷰 안에서 시작한 HTML5 드래그가 놓이지
 * 않는다. 탐색기 → 앱 가져오기를 지키면서 앱 안 드래그를 살리려고 마우스(포인터) 이벤트로 흉내 낸다.
 *
 * 받는 쪽은 `data-internal-drop` 속성을 단 요소에서 {@link INTERNAL_DROP_EVENT} 를 듣는다.
 */

import { t } from '../i18n'

export const INTERNAL_DROP_EVENT = 'iwae:internal-drop'

export interface InternalDropDetail {
  /** HTML5 의 dataTransfer 처럼 형식(MIME) → 문자열 */
  readonly data: Readonly<Record<string, string>>
  readonly clientX: number
  readonly clientY: number
}

export interface InternalDragOptions {
  /** 끄는 동안 포인터를 따라다닐 그림. 없으면 작은 꼬리표를 쓴다 */
  readonly preview?: HTMLElement | null
  /** 꼬리표 글자(preview 가 없을 때) */
  readonly label?: string
  /** 끌기가 실제로 시작될 때(문턱을 넘었을 때) */
  readonly onStart?: () => void
  /** 포인터가 움직일 때마다 그 아래의 받는 곳(없으면 null) */
  readonly onOver?: (target: Element | null, clientX: number, clientY: number) => void
  /** 끝날 때(놓았든 취소했든). dropped 는 받는 곳에 놓였는지, target 은 놓인 받는 곳 */
  readonly onEnd?: (dropped: boolean, target: Element | null, clientX: number, clientY: number) => void
}

const THRESHOLD_PX = 4

let active = false

/** 지금 앱 안 드래그 중인가(받는 쪽이 모양을 바꾸는 데 쓴다) */
export function isInternalDragActive(): boolean {
  return active
}

/**
 * pointerdown 에서 부른다. 포인터가 조금 움직이면 끌기가 시작되고, 놓은 자리의 받는 곳에
 * 이벤트를 보낸다. 움직이지 않고 떼면 아무 일도 없다(클릭은 그대로 동작한다).
 */
export function startInternalDrag(
  start: { readonly clientX: number; readonly clientY: number; readonly pointerId: number },
  data: Readonly<Record<string, string>>,
  options: InternalDragOptions = {},
): void {
  let started = false
  let over: Element | null = null
  let ghost: HTMLElement | null = null

  const place = (x: number, y: number) => {
    if (ghost === null) return
    const width = ghost.offsetWidth
    const height = ghost.offsetHeight
    ghost.style.left = `${x - width / 2}px`
    ghost.style.top = `${y - height / 2}px`
  }

  const targetAt = (x: number, y: number): Element | null => {
    if (typeof document.elementFromPoint !== 'function') return null
    const element = document.elementFromPoint(x, y)
    return element?.closest('[data-internal-drop]') ?? null
  }

  const begin = () => {
    started = true
    active = true
    ghost = options.preview ?? null
    if (ghost === null) {
      ghost = document.createElement('div')
      ghost.className = 'internal-drag-chip'
      ghost.textContent = options.label ?? t('노트로 끌기')
    }
    ghost.classList.add('internal-drag-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    document.body.append(ghost)
    document.body.classList.add('internal-dragging')
    window.getSelection()?.removeAllRanges?.()
    options.onStart?.()
  }

  const setOver = (next: Element | null) => {
    if (next === over) return
    over?.classList.remove('internal-drop-over')
    next?.classList.add('internal-drop-over')
    over = next
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return
    if (!started) {
      if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < THRESHOLD_PX) return
      begin()
    }
    event.preventDefault()
    place(event.clientX, event.clientY)
    const target = targetAt(event.clientX, event.clientY)
    setOver(target)
    options.onOver?.(target, event.clientX, event.clientY)
  }

  const finish = (dropAt: { x: number; y: number } | null) => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    if (!started) return
    let dropped = false
    const target = dropAt === null ? null : targetAt(dropAt.x, dropAt.y)
    setOver(null)
    ghost?.remove()
    document.body.classList.remove('internal-dragging')
    active = false
    if (dropAt !== null) suppressClickAt(dropAt.x, dropAt.y)
    if (target !== null && dropAt !== null) {
      const detail: InternalDropDetail = { data, clientX: dropAt.x, clientY: dropAt.y }
      target.dispatchEvent(new CustomEvent<InternalDropDetail>(INTERNAL_DROP_EVENT, { detail, bubbles: false }))
      dropped = true
    }
    options.onEnd?.(dropped, target, dropAt?.x ?? 0, dropAt?.y ?? 0)
  }

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return
    finish({ x: event.clientX, y: event.clientY })
  }
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return
    finish(null)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !started) return
    event.preventDefault()
    event.stopPropagation()
    finish(null)
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
}

/** 끌기를 마친 포인터를 떼면 그 자리 단추에 click 이 생긴다. 끌기였으니 그 한 번은 먹는다 */
function suppressClickAt(x: number, y: number): void {
  const swallow = (event: MouseEvent) => {
    window.removeEventListener('click', swallow, true)
    if (Math.abs(event.clientX - x) > 4 || Math.abs(event.clientY - y) > 4) return
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', swallow, true)
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
}
