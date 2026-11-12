import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PaneId, Tab } from './tabs'
import type { PaneChannel } from './workspaceChannels'
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

/** 상단바 도구줄의 주인 칩(색 점 · 칸 번호 · 문서 종류) */
export interface ToolbarOwner {
  readonly channel: PaneChannel
  /** 칸 번호(트리의 칸). 떠 있는 칸 · 번호를 모르면 null */
  readonly number: number | null
  readonly kind: 'pdf' | 'markdown' | 'memoNote'
}

/** 만지는 칸이 보는 탭에 도구줄이 있는 종류(PDF · MD · 메모 노트)일 때만 주인이 있다. 빈 칸 · 캔버스는 null(자리가 빈다) */
export function toolbarOwnerOf(tab: Tab | null, channel: PaneChannel, number: number | null): ToolbarOwner | null {
  if (tab === null || (tab.kind !== 'pdf' && tab.kind !== 'markdown' && tab.kind !== 'memoNote')) return null
  return { channel, number, kind: tab.kind }
}

/** 상단바 자리가 있는가(없으면 호출한 곳이 칸 안에 그린다) */
export function useHasTopBarSlot(): boolean {
  return useContext(TopBarToolbarContext) !== null
}

/**
 * children 을 상단바 도구줄 자리에 그린다(이 칸이 만지는 칸일 때만). 상단바 자리가 없으면 아무것도 그리지 않는다 —
 * 그때는 호출한 쪽이 `useHasTopBarSlot()` 로 알아 보고 칸 안에 직접 놓는다.
 * 포털이라 React 트리에서는 이 칸 안에 있다: 상태 · 문맥(PaneIdContext · 번역기 …)은 그대로 이어진다. 키보드 초점(Tab) 순서는 DOM 을 따르므로 상단바 자리의 순서다(칸 본문이 아니다).
 * React 이벤트도 포털을 지나 칸 쪽으로 올라가므로, 칸의 누름 처리(`PaneCard` · `.pane-focus-scope`)는 `eventInTopBarSlot` 으로 상단바 도구줄 자리에서 일어난 것만 거른다.
 * 칸에 딸린 다른 포털(body 에 그려지는 우클릭 메뉴 · 노트 카드 메뉴 · 박스 메모 메뉴)의 누름은 거르지 않는다 — 그 항목을 눌러도 그 칸이 만지는 칸이 된다.
 * (여기서 stopPropagation 을 하지 않는다: 막으면 document 의 「바깥을 누르면 닫기」 같은 바깥 듣기도 못 받는다. 칸의 누름은 capture 단계라 어차피 경계 안쪽에서 먼저 막을 수 없다.)
 */
export function TopBarToolbar({ children }: { readonly children: ReactNode }) {
  const slot = useContext(TopBarToolbarContext)
  const pane = useContext(PaneIdContext)
  if (slot === null || slot.element === null || !ownsTopBarToolbar(slot.activePane, pane)) return null
  return createPortal(children, slot.element)
}

/**
 * 이벤트가 상단바 도구줄 자리의 DOM 자손에서 일어났는가. 상단바 도구줄은 React 트리로는 칸 안이지만 DOM 으로는 밖이라, 칸의 누름 처리가 이것으로 거른다.
 * 자리 요소만 본다: 칸에 딸린 body 포털 메뉴(ContextMenu · NoteFlow · PdfBoxMemos)도 DOM 으로는 카드 밖이지만 그 누름은 칸을 누른 것이다.
 */
export function eventInTopBarSlot(event: { readonly target: EventTarget }, slotElement: HTMLElement | null): boolean {
  return slotElement !== null && event.target instanceof Node && slotElement.contains(event.target)
}
