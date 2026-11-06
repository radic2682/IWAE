import { fireEvent } from '@testing-library/react'
import { INTERNAL_DROP_EVENT, type InternalDropDetail } from '../core/internalDrag'

/**
 * 테스트용: `source` 에서 포인터 끌기를 해서 받는 곳(임시 요소)에 놓고, 받은 내용을 돌려준다.
 * jsdom 에는 elementFromPoint 가 없어 그 자리를 받는 곳으로 흉내 낸다.
 */
export function dragInternally(source: Element, target?: Element): InternalDropDetail | null {
  const zone = target ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'test-drop-zone' }))
  zone.setAttribute('data-internal-drop', 'test')
  let received: InternalDropDetail | null = null
  const listener = (event: Event) => { received = (event as CustomEvent<InternalDropDetail>).detail }
  zone.addEventListener(INTERNAL_DROP_EVENT, listener)
  const original = document.elementFromPoint
  document.elementFromPoint = () => zone
  try {
    fireEvent.pointerDown(source, { clientX: 10, clientY: 10, pointerId: 7, button: 0 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60, pointerId: 7 })
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80, pointerId: 7 })
  } finally {
    document.elementFromPoint = original
    zone.removeEventListener(INTERNAL_DROP_EVENT, listener)
    if (target === undefined) zone.remove()
  }
  return received
}

/** 테스트용: `source` 를 포인터로 끌어 `target` 위에 놓는다(받는 곳 판정은 컴포넌트가 한다) */
export function pointerDragTo(source: Element, target: Element, options: { readonly endY?: number } = {}): void {
  const original = document.elementFromPoint
  document.elementFromPoint = () => target
  try {
    fireEvent.pointerDown(source, { clientX: 10, clientY: 10, pointerId: 3, button: 0 })
    fireEvent.pointerMove(window, { clientX: 10, clientY: options.endY ?? 40, pointerId: 3 })
    fireEvent.pointerUp(window, { clientX: 10, clientY: options.endY ?? 40, pointerId: 3 })
  } finally {
    document.elementFromPoint = original
  }
}
