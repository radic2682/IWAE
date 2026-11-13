import { pickFreeChannel } from './noteBeside'
import type { PaneId } from './tabs'
import { channelOf, type Channel, type PaneChannels } from './workspaceChannels'

/**
 * 색 점을 다른 칸으로 끌어 놓아 두 칸을 잇는 규칙(순수).
 * - 끈 칸에 채널이 있으면 놓은 칸이 그 채널을 받는다.
 * - 끈 칸에 채널이 없으면: 두 칸을 뺀 다른 보이는 칸이 쓰지 않는 첫 색(파랑 · 초록 · 주황 차례), 모두 쓰고 있으면 파랑 — 두 칸 모두에 준다.
 * - 자기 자신에게 놓으면(또는 칸이 아닌 곳) 아무 일도 없다(null).
 */
export interface ChannelLink {
  readonly channels: PaneChannels
  /** 두 칸이 이제 함께 쓰는 채널 */
  readonly channel: Channel
  /** 채널이 바뀐(또는 새로 정해진) 칸들. 이미 같은 색이면 비어 있지 않아도 반응 표시는 두 칸 모두에 한다 */
  readonly panes: readonly [PaneId, PaneId]
}

export function resolveChannelLink(channels: PaneChannels, visible: readonly PaneId[], source: PaneId, target: PaneId): ChannelLink | null {
  if (source === target) return null
  const own = channelOf(channels, source)
  if (own !== null) return { channels: { ...channels, [target]: own }, channel: own, panes: [source, target] }
  const channel = pickFreeChannel(channels, visible.filter((pane) => pane !== source && pane !== target))
  return { channels: { ...channels, [source]: channel, [target]: channel }, channel, panes: [source, target] }
}
