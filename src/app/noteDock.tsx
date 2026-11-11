import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 오른쪽 노트 바 자리. 노트 바는 창 맨 오른쪽(모든 문서 창 바깥)에 하나만 있다 —
 * 어느 문서 창에 PDF 가 있든, 빈 창이 있든 같은 자리다. SplitPanes 가 이 자리(dock)를 만들고,
 * 노트 바를 그리는 문서 창(host)의 PdfPane·MarkdownPane 이 거기에 portal 로 그린다.
 */
export interface NoteDockValue {
  /** 창 맨 오른쪽 노트 바 칸. 아직 없으면 null */
  readonly dock: HTMLElement | null
  /** 노트 바를 그릴 문서 창(만진 창이 문서면 그 창, 아니면 문서가 있는 다른 창). 없으면 null */
  readonly hostPane: string | null
}

export const NoteDockContext = createContext<NoteDockValue>({ dock: null, hostPane: null })

export function useNoteDock(): HTMLElement | null {
  return useContext(NoteDockContext).dock
}

/** 이 문서 창이 노트 바를 그릴 창인가(문서 창 틀 밖에서 쓰면 true) */
export function useIsNoteHostPane(ref: RefObject<HTMLElement | null>): boolean {
  const { hostPane } = useContext(NoteDockContext)
  const [paneId, setPaneId] = useState<string | null>(null)
  const lastPaneId = useRef<string | null>(null)
  useEffect(() => {
    // 달라졌을 때만 상태를 바꾼다(같은 값 갱신도 한 번 더 그리게 만든다)
    const next = ref.current?.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId ?? null
    if (next === lastPaneId.current) return
    lastPaneId.current = next
    setPaneId(next)
  })
  // 창 이름을 알 수 없는 곳(시험, 단독 사용)은 늘 host
  if (paneId === null) return hostPane === null ? true : false
  return hostPane === paneId
}

/** 노트 바가 열리고 닫힐 때의 전환 시간(ms). layout-transitions.css 의 --layout-duration 과 맞춘다 */
export const NOTE_BAR_TRANSITION_MS = 230

/**
 * 노트 바를 닫을 때 바로 지우지 않고 닫히는 전환이 끝날 때까지 그려 두는 표시.
 * rendered: 그려야 하는가, exiting: 닫히는 중인가(닫히는 모양 클래스를 붙인다)
 */
export function useNoteBarPresence(open: boolean): { readonly rendered: boolean; readonly exiting: boolean } {
  const [rendered, setRendered] = useState(open)
  useEffect(() => {
    if (open) { setRendered(true); return undefined }
    if (!rendered) return undefined
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setRendered(false); return undefined }
    const timer = window.setTimeout(() => setRendered(false), NOTE_BAR_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [open, rendered])
  return { rendered: open || rendered, exiting: !open && rendered }
}

/**
 * 노트 바 몸통의 윗선(화면 y). 문서 창이 앱 격자(위아래로 나눈 배치)의 아래 칸에 있어도 바는 위 칸과 같은 높이에서 시작한다 —
 * 아래 칸의 PDF 가 바를 그리는 호스트여도 노트 바 윗부분이 비지 않는다.
 * areaTop: 이 창(또는 PDF 안 나눔 상자)의 윗선, gridTop: 격자 상자 윗선(격자가 아니면 undefined), cellTop: 이 창이 든 칸 몸통의 윗선
 */
export function noteBarAnchorTop(areaTop: number, gridTop: number | undefined, cellTop: number | undefined): number {
  return gridTop === undefined || cellTop === undefined ? areaTop : gridTop + (areaTop - cellTop)
}
