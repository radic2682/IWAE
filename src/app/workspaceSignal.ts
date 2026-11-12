import type { PaneId } from './tabs'
import type { Channel, PaneChannel } from './workspaceChannels'

/**
 * 가리키기 신호: 창과 창은 이 신호 하나로만 잇는다(docs/design/workspace-channels.md 3.3).
 * 보낸 창과 채널이 같은 창이 받고, 채널이 없으면(null) 보낸 창만 처리한다(받는 쪽이 자기 신호를 건너뛰므로 아무도 받지 않는다).
 * 받는 창은 자기 탭 종류대로 반응한다: PDF·Markdown 은 그 자리로 스크롤해 깜빡이고, 메모 노트는 그 카드를 연다.
 */
export type PointTarget =
  /**
   * 형광펜·카드·캔버스 칸. memoId 는 형광펜 id(노트 블록 id 가 아니다).
   * notePath·blockId 는 티켓의 「다른 자리」처럼 어느 노트의 어느 블록인지 정해진 경우 — 그 노트를 보이고 그 블록으로 간다
   */
  | { readonly kind: 'memo'; readonly memoId: string; readonly notePath?: string; readonly blockId?: string }
  /** AI 위치·검색 결과 */
  | { readonly kind: 'place'; readonly docId: string; readonly page: number; readonly range?: readonly [number, number] }

export interface PointSignal {
  readonly from: PaneId
  readonly channel: Channel | null
  readonly target: PointTarget
  readonly reason: 'click' | 'ai' | 'search'
  /**
   * 보낸 쪽이 문서 화면('document': 문서의 형광펜)인가 노트 화면('note': 노트 카드·출처)인가. 없으면 보낸 창의 보이는 탭 종류로 본다.
   * 메모 노트 탭의 카드·출처를 누르면 'note', 문서의 형광펜을 누르면 'document'.
   */
  readonly origin?: 'document' | 'note'
}

/** 버스를 지나간 신호(차례 번호·시각이 붙는다) */
export interface DeliveredSignal extends PointSignal {
  readonly seq: number
  readonly at: number
}

/** 신호가 오고 이 시간이 지나면 늦게 열린 창은 더 이상 받지 않는다(탭이 열리는 동안만 기다려 준다) */
export const POINT_SIGNAL_TTL_MS = 8000

type Listener = (signal: DeliveredSignal) => void

const listeners = new Set<Listener>()
let lastSignal: DeliveredSignal | null = null
let sequence = 0

/** 신호를 보낸다. 받는 창이 바로 처리하고, 아직 안 열린 탭은 열린 뒤 (TTL 안에) pendingPointSignal 로 받는다 */
export function emitPointSignal(signal: PointSignal): DeliveredSignal {
  sequence += 1
  const delivered: DeliveredSignal = { ...signal, seq: sequence, at: Date.now() }
  lastSignal = delivered
  for (const listener of [...listeners]) listener(delivered)
  return delivered
}

export function subscribePointSignal(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** afterSeq 보다 나중의, 아직 유효한 마지막 신호. 늦게 열린 탭이 부른다 */
export function pendingPointSignal(afterSeq: number, now = Date.now()): DeliveredSignal | null {
  if (lastSignal === null || lastSignal.seq <= afterSeq || now - lastSignal.at > POINT_SIGNAL_TTL_MS) return null
  return lastSignal
}

/** 시험용: 버스를 비운다 */
export function resetPointSignals(): void {
  listeners.clear()
  lastSignal = null
}

/**
 * pane(채널 paneChannel)이 이 신호를 받는가: 보낸 창 자신은 이미 스스로 처리했으므로 받지 않고,
 * 채널이 없는 신호는 아무도 받지 않으며, 그 밖에는 채널이 같은 창이 받는다.
 */
export function paneReceives(signal: PointSignal, pane: PaneId, paneChannel: PaneChannel): boolean {
  if (pane === signal.from || signal.channel === null) return false
  return paneChannel === signal.channel
}
