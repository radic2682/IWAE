import type { CSSProperties } from 'react'
import { fractionOffset, type PdfSplitDivider } from '../../core/pdfSplit'

/** 칸 사이 구분선의 자리·길이(칸 묶음 전체에 대한 %). PDF 와 Markdown 의 나눈 칸이 함께 쓴다 */
export function dividerStyle(divider: PdfSplitDivider, cols: readonly number[], rows: readonly number[]): CSSProperties {
  const along = divider.axis === 'col' ? cols : rows
  const across = divider.axis === 'col' ? rows : cols
  const at = `${fractionOffset(along, divider.boundary) * 100}%`
  const from = `${fractionOffset(across, divider.start) * 100}%`
  const size = `${(fractionOffset(across, divider.end) - fractionOffset(across, divider.start)) * 100}%`
  return divider.axis === 'col' ? { left: at, top: from, height: size } : { top: at, left: from, width: size }
}

/** 포인터가 칸 묶음 안 어디쯤인지(0~1). 묶음 크기를 알 수 없으면 null */
export function dividerPointerFraction(
  axis: 'col' | 'row',
  pointer: { readonly clientX: number; readonly clientY: number },
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): number | null {
  if (box.width <= 0 || box.height <= 0) return null
  return axis === 'col' ? (pointer.clientX - box.left) / box.width : (pointer.clientY - box.top) / box.height
}

/**
 * 구분선 끌기를 시작한다(pointerdown 에서 부른다). 끄는 동안 포인터가 움직일 때마다 apply 에 새 자리(0~1)를 준다.
 * 구분선에 포인터를 붙들어 두므로 칸 밖으로 나가도 이어지고, 놓거나 취소하거나 붙들기가 풀리면 끝난다
 */
export function startDividerDrag(
  event: { readonly button: number; readonly pointerId: number; readonly currentTarget: Element; preventDefault(): void },
  axis: 'col' | 'row',
  getBox: () => { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | undefined,
  apply: (at: number) => void,
): void {
  if (event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget
  handle.setPointerCapture?.(event.pointerId)
  const move = (moveEvent: Event) => {
    const box = getBox()
    if (box === undefined) return
    const at = dividerPointerFraction(axis, moveEvent as PointerEvent, box)
    if (at !== null) apply(at)
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}
