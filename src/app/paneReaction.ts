import { useSyncExternalStore } from 'react'
import { leaves, type LayoutNode } from '../core/layoutTree'
import { activeTab, tabDocId, tabsOf, type PaneId, type PanesState } from './tabs'
import type { Channel, PaneChannel, PaneChannels } from './workspaceChannels'
import { channelOf } from './workspaceChannels'
import type { PointTarget } from './workspaceSignal'

/**
 * 「어느 창이 반응하는가」를 눈에 보이게 하는 순수 계산과 작은 저장소(docs/design/workspace-tmux.md 12 · 칸 반응 표시).
 *
 * 같은 채널 색의 창끼리만 가리키기 신호를 주고받는다(workspaceSignal). 메모 카드 · 문서의 형광펜 위에 마우스를 올리면(hover)
 * 그 신호가 가면 움직일 다른 창에 채널 색의 옅은 안쪽 윤곽이 생기고, 마우스가 떠나면 없어진다. 신호가 실제로 창을 움직였을 때는
 * 그 창에 같은 윤곽이 0.6초 동안 생겼다가 바로 사라진다. 둘 다 정적이다(움직임 · 맥박 없음, 켜고 끄기만).
 */

/** 신호가 실제로 창을 움직였을 때 윤곽이 남는 시간(ms) */
export const REACTION_FLASH_MS = 600

export interface ReactionInput {
  /** 마우스를 올린(또는 신호를 보낼) 창 */
  readonly from: PaneId
  /** 가리키기 대상: 형광펜(메모) · 문서 자리 */
  readonly target: PointTarget
  /** 지금 보이는 창들(트리의 칸 + 보이는 떠 있는 칸) */
  readonly visible: readonly PaneId[]
  readonly panes: PanesState
  readonly channels: PaneChannels
  /** 메모가 들어 있는 노트들(Vault 상대 경로) */
  readonly notesOf: (memoId: string) => readonly string[]
  /** 메모(형광펜)의 문서 id. 모르면 null */
  readonly docIdOfMemo: (memoId: string) => string | null
  /** 이 창의 캔버스가 그 메모에 이어진 블록을 갖고 있는가(캔버스가 켜져 있을 때만 준다) */
  readonly canvasShowsMemo?: (pane: PaneId, memoId: string) => boolean
}

/**
 * 이 신호가 가면 반응할 창들: 보낸 창과 채널이 같고(없으면 아무도 없다) 그 대상을 보여 주는 창.
 * - 메모(형광펜): 그 메모가 든 노트를 보는 메모 노트 탭(notePath 가 있으면 그 노트만), 그 메모의 문서를 보는 문서 탭, 이어진 블록이 있는 캔버스
 * - 문서 자리(AI · 검색): 그 문서를 보는 문서 탭
 * 보낸 창 자신은 건너뛴다(paneReceives 와 같다). 보이는 순서대로 돌려준다.
 */
export function reactingPanes(input: ReactionInput): PaneId[] {
  const { from, target, visible, panes, channels } = input
  const channel = channelOf(channels, from)
  if (channel === null) return []
  const docId = target.kind === 'memo' ? input.docIdOfMemo(target.memoId) : target.docId
  const owners = target.kind === 'memo' ? input.notesOf(target.memoId) : []
  return visible.filter((pane) => {
    if (pane === from || channelOf(channels, pane) !== channel) return false
    const tab = activeTab(tabsOf(panes, pane))
    if (tab === null) return false
    if (tab.kind === 'memoNote') {
      if (target.kind !== 'memo') return false
      return target.notePath !== undefined ? tab.id === target.notePath : owners.includes(tab.id)
    }
    if (tab.kind === 'pdf' || tab.kind === 'markdown') return docId !== null && tabDocId(tab) === docId
    if (tab.kind === 'canvas') return target.kind === 'memo' && input.canvasShowsMemo?.(pane, target.memoId) === true
    return false
  })
}

/** 지금 보이는 창들(트리의 칸 차례대로) — 위 계산의 visible */
export const visiblePanesOf = (layout: LayoutNode, floats: readonly PaneId[]): PaneId[] => [...leaves(layout), ...floats]

// ── 저장소 ────────────────────────────────────────────────────────────────────

type Reaction = ReadonlyMap<PaneId, Channel>
const NONE: Reaction = new Map()

let hover: Reaction = NONE
let flash: Reaction = NONE
const flashTimers = new Map<PaneId, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const emit = () => { for (const listener of [...listeners]) listener() }

/** 마우스를 올린 동안의 윤곽(null 이면 거둔다). 같은 값이면 알리지 않는다 */
export function setHoverReaction(panes: ReadonlyMap<PaneId, Channel> | null): void {
  const next = panes === null || panes.size === 0 ? NONE : panes
  if (next === hover) return
  if (next.size === hover.size && [...next].every(([pane, channel]) => hover.get(pane) === channel)) return
  hover = next
  emit()
}

/** 신호가 pane 을 실제로 움직였다: 채널 색 윤곽을 ms(기본 600ms) 동안 켰다가 바로 끈다 */
export function flashReaction(pane: PaneId, channel: PaneChannel, ms = REACTION_FLASH_MS): void {
  if (channel === null) return
  const old = flashTimers.get(pane)
  if (old !== undefined) clearTimeout(old)
  flash = new Map(flash).set(pane, channel)
  flashTimers.set(pane, setTimeout(() => {
    flashTimers.delete(pane)
    const rest = new Map(flash)
    rest.delete(pane)
    flash = rest.size === 0 ? NONE : rest
    emit()
  }, ms))
  emit()
}

/** 시험용: 모두 비운다 */
export function resetPaneReaction(): void {
  for (const timer of flashTimers.values()) clearTimeout(timer)
  flashTimers.clear()
  hover = NONE
  flash = NONE
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** pane 이 지금 반응하는 채널 색(깜빡임이 마우스 올림보다 먼저). 반응하지 않으면 null */
export function paneReactionOf(pane: PaneId): Channel | null {
  return flash.get(pane) ?? hover.get(pane) ?? null
}

export function usePaneReaction(pane: PaneId): Channel | null {
  return useSyncExternalStore(subscribe, () => paneReactionOf(pane), () => null)
}
