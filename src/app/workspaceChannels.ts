import { PANE_IDS, type PaneId } from './tabs'

/**
 * 색 채널: 창(패널)마다 붙는 연동 색. 같은 색의 창끼리만 가리키기 신호(workspaceSignal)를 주고받는다.
 * 채널은 탭이 아니라 창에 붙고, null 은 어느 창과도 연동하지 않는다. DOM·React 를 모르는 순수 함수만 둔다.
 */
export type Channel = 'blue' | 'green' | 'orange'
export type PaneChannel = Channel | null
export type PaneChannels = Readonly<Record<PaneId, PaneChannel>>

export const CHANNELS: readonly Channel[] = ['blue', 'green', 'orange']

/** 처음 열면 모든 창이 파랑 — 지금처럼 모두 한데 연동한다 */
export const DEFAULT_CHANNELS: PaneChannels = { left: 'blue', right: 'blue', third: 'blue', fourth: 'blue' }

/** 점을 누를 때마다: 파랑 → 초록 → 주황 → 없음 → 파랑 */
export function cycleChannel(channel: PaneChannel): PaneChannel {
  if (channel === null) return 'blue'
  const next = CHANNELS[CHANNELS.indexOf(channel) + 1]
  return next ?? null
}

export function isChannel(value: unknown): value is Channel {
  return value === 'blue' || value === 'green' || value === 'orange'
}

/** 저장된 값에서 읽는다. 없는 창·모르는 값은 기본(파랑), 저장된 null(없음)은 그대로 */
export function parsePaneChannels(raw: unknown): PaneChannels {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_CHANNELS
  const record = raw as Record<string, unknown>
  const pick = (pane: PaneId): PaneChannel => {
    const value = record[pane]
    return value === null ? null : isChannel(value) ? value : DEFAULT_CHANNELS[pane]
  }
  return { left: pick('left'), right: pick('right'), third: pick('third'), fourth: pick('fourth') }
}

/** pane 의 채널을 cycle 한 새 값 */
export function cyclePaneChannel(channels: PaneChannels, pane: PaneId): PaneChannels {
  return { ...channels, [pane]: cycleChannel(channels[pane]) }
}

/** 두 창의 채널을 맞바꾼다(칸막이 「양쪽 바꾸기」) */
export function swapPaneChannels(channels: PaneChannels, a: PaneId, b: PaneId): PaneChannels {
  return { ...channels, [a]: channels[b], [b]: channels[a] }
}

/**
 * 칸이 닫히거나 배치가 바뀌어 창이 옮겨 갈 때 채널도 따라간다. keep[slot] = 새 칸 slot 에 들어간 옛 칸 번호.
 * 새로 비는 칸은 기본값(파랑)으로 되돌린다.
 */
export function remapChannelsByKeep(channels: PaneChannels, keep: readonly number[]): PaneChannels {
  const next = { ...DEFAULT_CHANNELS } as Record<PaneId, PaneChannel>
  keep.forEach((from, slot) => { next[PANE_IDS[slot]!] = channels[PANE_IDS[from]!] })
  return next
}

/**
 * 탭을 떼어 새 창을 만들 때(dockTab): 새 칸 차례(slots)에 맞춰 채널을 옮기고, 새로 생긴 칸은 탭이 온 창(source)의 채널을 받는다.
 */
export function remapChannelsBySlots(channels: PaneChannels, slots: readonly (number | 'new')[], source: PaneId): PaneChannels {
  const next = { ...DEFAULT_CHANNELS } as Record<PaneId, PaneChannel>
  slots.forEach((slot, index) => {
    next[PANE_IDS[index]!] = slot === 'new' ? channels[source] : channels[PANE_IDS[slot]!]
  })
  return next
}
