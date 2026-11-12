import { INITIAL_READER_TOOL_STATE, type ReaderToolState } from '../core/readerTools'

/**
 * 칸 도구줄(PaneToolbar)이 칸을 옮겨 만질 때 다시 만들어져도 잃지 않는 상태. 도구줄은 상단바에 지금 만지는 칸 것만 있으므로
 * 칸을 바꿀 때마다 그려졌다 사라진다 — 칸 id 마다 넘침 단계 · 검색 단추(고정 · 펼침)를 여기에 적어 두고 다시 그릴 때 이어 받는다.
 */
export interface PaneToolbarMemory {
  /** 넘쳐서 「⋯」 로 접은 묶음 수(0–3) */
  readonly overflowLevel: number
  /** 단계마다 처음 넘쳤던 너비(다시 넓어졌는지 보려고) */
  readonly needWidth: number[]
  /** 읽기 도구줄 상태(검색 고정 · 펼침) */
  readonly reader: ReaderToolState
}

const memory = new Map<string, PaneToolbarMemory>()

export const freshPaneToolbarMemory = (): PaneToolbarMemory => ({ overflowLevel: 0, needWidth: [], reader: INITIAL_READER_TOOL_STATE })

export function readPaneToolbarMemory(pane: string | null): PaneToolbarMemory {
  return (pane === null ? undefined : memory.get(pane)) ?? freshPaneToolbarMemory()
}

export function writePaneToolbarMemory(pane: string | null, value: PaneToolbarMemory): void {
  if (pane !== null) memory.set(pane, value)
}

/** 시험용 */
export function resetPaneToolbarMemory(): void {
  memory.clear()
}
