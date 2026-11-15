import { passedDragThreshold } from './formatBarPlace'

/** 끄는 동안 body 에 붙는 이름: 칸 안의 것이 올림에 반응하지 않고 손 모양이 잡은 손으로 바뀐다 */
export const GRIP_DRAGGING_CLASS = 'format-bar-dragging'

export interface GripDragHandlers {
  /** 문턱(6px)을 처음 넘긴 순간 한 번 */
  readonly onStart?: () => void
  /** 문턱을 넘긴 뒤 포인터가 움직일 때마다 */
  readonly onMove: (event: PointerEvent) => void
  /** 문턱을 넘긴 채로 놓았을 때(문턱을 못 넘긴 눌렀다 뗌은 부르지 않는다) */
  readonly onDrop: (event: PointerEvent) => void
  /** Esc · pointercancel · 정리로 끌기가 끝났을 때(놓기로 끝난 때는 부르지 않는다) */
  readonly onCancel: () => void
}

/**
 * 손잡이 끌기의 공통 뼈대(서식 줄 · 상단바 도구줄이 같이 쓴다): 문턱을 넘길 때까지는 눌렀다 뗌으로 두고, 넘긴 뒤에는 포인터를 따라가며,
 * 놓으면 onDrop, Esc · 취소면 onCancel. 반환값은 정리 함수(끌기 도중 호출하면 듣기만 걷고 onCancel 은 부르지 않는다).
 */
export function trackGripDrag(start: { readonly x: number; readonly y: number }, handlers: GripDragHandlers): () => void {
  let started = false
  let done = false
  const clear = () => {
    if (done) return
    done = true
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    document.body.classList.remove(GRIP_DRAGGING_CLASS)
  }
  function onMove(move: PointerEvent) {
    if (!started) {
      if (!passedDragThreshold(move.clientX - start.x, move.clientY - start.y)) return
      started = true
      document.body.classList.add(GRIP_DRAGGING_CLASS)
      handlers.onStart?.()
    }
    handlers.onMove(move)
  }
  function onUp(up: PointerEvent) {
    const wasStarted = started
    clear()
    if (wasStarted) handlers.onDrop(up)
  }
  function onCancel() {
    const wasStarted = started
    clear()
    if (wasStarted) handlers.onCancel()
  }
  function onKey(key: KeyboardEvent) {
    if (key.key !== 'Escape') return
    key.preventDefault()
    key.stopPropagation()
    onCancel()
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  return clear
}
