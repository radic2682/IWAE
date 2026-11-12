import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PaneId } from './tabs'
import { PaneIdContext } from './workspaceContext'

/**
 * 상단바의 도구줄 자리(화면 탭과 창 단추 사이). 지금 만지는 칸(떠 있는 칸 포함)의 도구줄만 여기에 그려진다 —
 * MD · PDF 의 도구(읽기 · 쓰기 · 보기 단추)와 노트의 서식 줄(＋ 검색 · 펼치기). 칸 안에는 도구줄 줄이 없다.
 * 도구줄이 없는 칸(빈 칸 · 캔버스)은 자리를 비워 둔다. 값이 null 이면 상단바가 없는 곳(시험 · 단독)이라 칸 안에 그대로 그린다.
 */
export interface TopBarToolbarSlot {
  /** 상단바의 도구줄 자리 요소. 아직 그려지지 않았으면 null */
  readonly element: HTMLElement | null
  /** 지금 만지는 칸(없으면 null) */
  readonly activePane: PaneId | null
}

export const TopBarToolbarContext = createContext<TopBarToolbarSlot | null>(null)

/** 이 칸의 도구줄이 상단바에 그려져야 하는가: 만지는 칸 자신일 때만 */
export function ownsTopBarToolbar(activePane: PaneId | null, pane: PaneId | null): boolean {
  return pane !== null && activePane === pane
}

/** 상단바 자리가 있는가(없으면 호출한 곳이 칸 안에 그린다) */
export function useHasTopBarSlot(): boolean {
  return useContext(TopBarToolbarContext) !== null
}

/**
 * children 을 상단바 도구줄 자리에 그린다(이 칸이 만지는 칸일 때만). 상단바 자리가 없으면 아무것도 그리지 않는다 —
 * 그때는 호출한 쪽이 `useHasTopBarSlot()` 로 알아 보고 칸 안에 직접 놓는다.
 * 포털이라 React 트리에서는 이 칸 안에 있다: 상태 · 문맥(PaneIdContext · 번역기 …)과 키보드 초점 순서는 그대로다.
 */
export function TopBarToolbar({ children }: { readonly children: ReactNode }) {
  const slot = useContext(TopBarToolbarContext)
  const pane = useContext(PaneIdContext)
  if (slot === null || slot.element === null || !ownsTopBarToolbar(slot.activePane, pane)) return null
  return createPortal(children, slot.element)
}
