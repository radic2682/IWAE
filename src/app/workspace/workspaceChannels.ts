import type { PaneId } from './tabs'

/**
 * 색 채널: 창(패널)마다 붙는 연동 색. 같은 색의 창끼리만 가리키기 신호(workspaceSignal)를 주고받는다.
 * 채널은 탭이 아니라 창에 붙고, null 은 어느 창과도 연동하지 않는다. DOM·React 를 모르는 순수 함수만 둔다.
 */
export type Channel = 'blue' | 'green' | 'orange'
export type PaneChannel = Channel | null
/** 칸 id → 채널. 없는 칸은 기본(파랑)으로 본다(channelOf) */
export type PaneChannels = Readonly<Record<PaneId, PaneChannel>>

export const CHANNELS: readonly Channel[] = ['blue', 'green', 'orange']

/** 처음 열면 모든 창이 파랑 — 지금처럼 모두 한데 연동한다 */
export const DEFAULT_CHANNEL: Channel = 'blue'

/** 아무 칸도 정해 두지 않은 상태(모든 칸이 기본 파랑) */
export const DEFAULT_CHANNELS: PaneChannels = {}

/** pane 의 채널. 정해 둔 적이 없으면 기본(파랑), 저장된 null(없음)은 그대로 */
export function channelOf(channels: PaneChannels, pane: PaneId): PaneChannel {
  const value = channels[pane]
  return value === undefined ? DEFAULT_CHANNEL : value
}

/** 점을 누를 때마다: 파랑 → 초록 → 주황 → 없음 → 파랑 */
export function cycleChannel(channel: PaneChannel): PaneChannel {
  if (channel === null) return 'blue'
  const next = CHANNELS[CHANNELS.indexOf(channel) + 1]
  return next ?? null
}

export function isChannel(value: unknown): value is Channel {
  return value === 'blue' || value === 'green' || value === 'orange'
}

/** 저장된 값 하나. 모르는 값이면 undefined */
export function parseChannel(value: unknown): PaneChannel | undefined {
  return value === null ? null : isChannel(value) ? value : undefined
}

/** pane 의 채널을 cycle 한 새 값 */
export function cyclePaneChannel(channels: PaneChannels, pane: PaneId): PaneChannels {
  return { ...channels, [pane]: cycleChannel(channelOf(channels, pane)) }
}

/** 두 창의 채널을 맞바꾼다 */
export function swapPaneChannels(channels: PaneChannels, a: PaneId, b: PaneId): PaneChannels {
  return { ...channels, [a]: channelOf(channels, b), [b]: channelOf(channels, a) }
}

/** pane 의 채널을 정한 새 값 */
export function withChannel(channels: PaneChannels, pane: PaneId, channel: PaneChannel): PaneChannels {
  return channels[pane] === channel ? channels : { ...channels, [pane]: channel }
}

/**
 * 칸이 새로 생길 때: from 칸의 채널을 받는다(나누기의 새 칸은 지금 칸의 색을 받는다).
 * 모든 칸에 채널이 적히도록 지금 있는 칸(ids)의 값도 채운다.
 */
export function inheritChannel(channels: PaneChannels, from: PaneId, created: PaneId): PaneChannels {
  return { ...channels, [created]: channelOf(channels, from) }
}

/** 있는 칸(ids)의 채널만 남긴다. 바뀐 것이 없으면 같은 객체 */
export function pruneChannels(channels: PaneChannels, ids: readonly PaneId[]): PaneChannels {
  const keys = Object.keys(channels)
  if (keys.every((key) => ids.includes(key))) return channels
  return Object.fromEntries(keys.filter((key) => ids.includes(key)).map((key) => [key, channels[key]!]))
}
