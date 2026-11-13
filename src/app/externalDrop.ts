import type { DropPoint } from '../bridge/fileDrop'
import { dropZoneAt, type DropZone } from './dropZone'
import { createDockVisuals, paneCardOf, paneHitAt, type DockVisuals } from './workspace/tabDrag'
import type { PaneId } from './workspace/tabs'

/**
 * 탐색기에서 끌어 온 파일을 놓은 자리에서 할 일:
 * - 'pane': 칸 위 → 가져오지 않고 그 칸에 탭으로 연다(pane 이 null 이면 칸 사이 틈: 지금 칸에 연다)
 * - 'vault': 왼쪽 바(또는 작업 영역 밖) → 「Vault 에 넣기」. zone 은 폴더·줄 자리
 */
export type ExternalDropTarget =
  | { readonly kind: 'pane'; readonly pane: PaneId | null }
  | { readonly kind: 'vault'; readonly zone: Extract<DropZone, { kind: 'vault' }> }

export function resolveExternalDrop(
  point: DropPoint | undefined,
  zone: DropZone = dropZoneAt(point),
  hitAt: (x: number, y: number) => { readonly kind: string; readonly pane?: PaneId } = paneHitAt,
): ExternalDropTarget {
  if (zone.kind === 'vault') return { kind: 'vault', zone }
  const hit = point === undefined ? null : hitAt(point.x, point.y)
  return { kind: 'pane', pane: hit !== null && hit.kind !== 'none' && hit.pane !== undefined ? hit.pane : null }
}

/** 끄는 동안 칸 위 강조에 쓸 칸 id(왼쪽 바·밖이면 null) */
export function paneUnderExternalDrag(point: DropPoint | undefined): PaneId | null {
  const target = resolveExternalDrop(point)
  return target.kind === 'pane' ? target.pane : null
}

/**
 * 끄는 동안 칸 위 강조: 탭을 끌 때 쓰는 「가운데」 미리보기(칸 전체)를 그 칸에 띄운다 — 나누기 가장자리는 없다.
 * 끌기가 끝나거나 칸을 벗어나면 pane 에 null 을 준다.
 */
let hoverVisuals: DockVisuals | null = null
export function paintExternalPaneHover(pane: PaneId | null): void {
  const card = pane === null ? null : paneCardOf(pane)
  if (card === null) {
    hoverVisuals?.clear()
    hoverVisuals = null
    return
  }
  hoverVisuals ??= createDockVisuals()
  hoverVisuals.showPreview(card.getBoundingClientRect())
}
