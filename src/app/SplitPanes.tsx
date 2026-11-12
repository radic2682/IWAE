import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { SIDEBAR_DEFAULT, clampLeftFrac, clampSidebar } from './splitLayout'
import { applyRatios, clampRatioForSize, layoutRects, leaves, paneCount, type LayoutNode, type UnitRect } from '../core/layoutTree'
import { WorkspaceLinkLayer } from './WorkspaceLinkLayer'
import { FloatLayer, type AnchorRect } from './FloatLayer'
import type { FloatAnchor, FloatingPane } from './screens'
import '../ui/layout-transitions.css'
import { t } from '../i18n'

/** 한 칸이 화면을 차지하는가('zoom': zoomedPane 하나만 보이고 왼쪽 바도 접힌다) */
export type FocusedPane = 'split' | 'zoom'

/** transitionend 가 오지 않을 때(애니메이션 줄이기, 숨은 창) 전환 표시를 끄는 상한 */
const TRANSITION_FALLBACK_MS = 400

interface SplitPanesProps {
  sidebar: React.ReactNode
  /**
   * 창 맨 윗줄. 사이드바 위를 포함해 전체 폭을 가로지른다.
   *
   * 값이 아니라 함수인 이유: 상단바가 사이드바 폭(sidebarPx)에 맞춰 단추 묶음과 탭 구역의 자리를 잡아야 하는데,
   * 그 값의 주인은 이 컴포넌트의 드래그 상태이므로 렌더 시점에 여기서 건네준다.
   * 탭 줄은 상단바에 없다 — 칸이 하나여도 칸마다 자기 머리(renderHead)가 칸 맨 위에 있다.
   */
  topBar: (layout: { sidebarPx: number; leftFrac: number; sidebarVisible: boolean }) => React.ReactNode
  /** 사이드바를 접었는가. 접으면 사이드바와 그 구분선이 함께 사라진다 */
  sidebarCollapsed: boolean
  layout?: { sidebarPx: number; leftFrac: number }
  onLayoutChange?: (layout: { sidebarPx: number; leftFrac: number }) => void
  focusedPane?: FocusedPane
  /** focusedPane 이 'zoom' 일 때 화면을 차지하는 칸 */
  zoomedPane?: string | null
  /**
   * 라이브러리 모드. 사이드바가 작업 영역 전체로 펼쳐지고 칸들은
   * 마운트된 채 가려진다 — 돌아왔을 때 PDF 위치와 캔버스 상태가 그대로다.
   */
  libraryExpanded?: boolean
  /** 라이브러리를 올릴 자리 요소를 알려 준다(펼친 동안만 있다). 왼쪽 바 오른쪽 영역 전체를 덮는 자리 */
  onLibraryHost?: (element: HTMLElement | null) => void
  /** 칸 나누기 트리(docs/design/workspace-tmux.md 4). 칸 자리와 경계선이 여기서 나온다 */
  root: LayoutNode
  /** 세션을 바꿀 때마다 오르는 번호: 칸 DOM 의 열쇠에 섞어 칸 보기(PDF 렌더러 등)를 새로 마운트한다 */
  epoch?: number
  /** 경계선을 끌어 놓았을 때(비율이 바뀐 새 트리). 끄는 동안에는 이 안에서만 다시 그린다 */
  onRootChange?: (root: LayoutNode) => void
  /** 칸 하나의 본문. index 는 칸 번호(왼쪽 위부터 0) */
  renderPane: (paneId: string, index: number) => React.ReactNode
  /** 칸 머리(색 점 · 번호 · 탭 줄 · ⋯ 메뉴). 칸이 하나여도 늘 칸 맨 위에 놓인다 */
  renderHead?: (paneId: string, index: number) => React.ReactNode
  /** 앱 틀 맨 아래 상태 줄(칸 아래, 그 아래엔 아무것도 없다). 없으면 그리지 않는다 */
  statusBar?: React.ReactNode
  /**
   * 경계선에 마우스를 올리면 나오는 「양쪽 바꾸기」 단추. 그 나누기의 두 쪽을 맞바꾼다.
   * 단추를 누른 채 끌면 단추가 아니라 경계선 끌기다(크기 조정을 막지 않는다).
   */
  onSwapSplit?: (splitId: string) => void
  /** 떠 있는 칸들(설계 5). 지금 보이는 것만 준다. 칸 영역 안, 칸들 위에 카드로 그린다 */
  floats?: readonly FloatingPane[]
  /** 떠 있는 칸의 머리(탭 줄 + ▁ ⇲ × 단추). 없으면 칸 머리(renderHead)를 쓴다 */
  renderFloatHead?: (paneId: string) => React.ReactNode
  /** 떠 있는 칸의 자리 · 크기를 끌어 바꿨다 */
  onFloatChange?: (paneId: string, patch: Pick<FloatingPane, 'x' | 'y' | 'w' | 'h'> & { readonly anchor?: FloatAnchor }) => void
  /** 떠 있는 칸을 눌렀다: 맨 위로 올린다 */
  onFloatRaise?: (paneId: string) => void
}

const FULL: UnitRect = { x: 0, y: 0, w: 1, h: 1 }

/**
 * 사이드바 | 칸 나누기 트리. 경계선을 드래그해 크기를 바꾼다.
 *
 * 칸은 트리 모양대로 중첩하지 않고, 칸 id 를 key 로 한 평평한 목록에 절대 위치(%)로 놓는다 —
 * 나누기·닫기로 트리 모양이 바뀌어도 남은 칸의 DOM 이 그대로여서 PDF 보기(스크롤·배율)가 다시 만들어지지 않는다.
 *
 * 포인터 캡처를 쓰는 이유: 마우스를 빠르게 끌면 커서가 구분선 밖으로
 * 나가고, 캡처가 없으면 그 순간 pointermove 가 끊겨 드래그가 멈춘다.
 *
 * dragController 는 "동시에 살아있는 드래그는 하나뿐"이라는 불변식을
 * 지킨다. pointerup 이 유실되거나(캡처가 깨졌는데 합성 이벤트가 안 오는
 * 경우) 언마운트 중에 드래그가 안 끝나면, window 에 매단 리스너가 남아
 * 다음 드래그와 겹쳐서 커서 하나가 사이드바와 분할선을 동시에 움직이는
 * 사고가 난다. 드래그를 시작할 때마다 이전 컨트롤러를 먼저 abort 하므로,
 * pointerup 을 한 번 놓쳐도 다음 pointerdown 이 알아서 청소한다.
 */
export function SplitPanes({
  sidebar,
  topBar,
  sidebarCollapsed,
  layout,
  onLayoutChange,
  focusedPane = 'split',
  zoomedPane = null,
  libraryExpanded = false,
  onLibraryHost,
  root,
  epoch = 0,
  onRootChange,
  renderPane,
  renderHead,
  statusBar,
  onSwapSplit,
  floats = [],
  renderFloatHead,
  onFloatChange,
  onFloatRaise,
}: SplitPanesProps) {
  const [storedSidebarPx, setSidebarPx] = useState(() => clampSidebar(layout?.sidebarPx ?? SIDEBAR_DEFAULT))
  // 사용자가 사이드바 폭을 한 번도 끌어 조절하지 않았으면, 사이드바 오른쪽 선을 상단바 왼쪽 단추 묶음
  // (로고 메뉴·사이드바 접기·보기 탭)의 오른쪽 끝에 맞춘다. 첫 탭이 사이드바 경계에서 바로 시작한다.
  // 한 번 끌면 그 뒤로는 사용자가 정한 폭을 그대로 쓴다.
  const [sidebarUserSized, setSidebarUserSized] = useState(readSidebarUserSized)
  const [fitSidebarPx, setFitSidebarPx] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const sidebarPx = sidebarUserSized || fitSidebarPx === null ? storedSidebarPx : fitSidebarPx
  // 예전 세션의 leftFrac 는 칸 비율이 트리로 옮겨 가서 여기서는 쓰지 않는다. 저장 형식을 바꾸지 않으려 그대로 이어 준다
  const leftFracRef = useRef(clampLeftFrac(layout?.leftFrac ?? 0.5))
  const panesRef = useRef<HTMLDivElement>(null)
  const dragController = useRef<AbortController | null>(null)

  useEffect(() => () => dragController.current?.abort(), [])

  useEffect(() => {
    if (layout === undefined) return
    setSidebarPx(clampSidebar(layout.sidebarPx))
    leftFracRef.current = clampLeftFrac(layout.leftFrac)
  }, [layout])

  // 끄는 동안의 최신 값. 화면은 프레임마다 한 번만 고치고, 바깥(App 전체를 다시 그리는 onLayoutChange)에는
  // 놓을 때 한 번만 알린다 — 예전에는 포인터가 움직일 때마다 App 전체가 다시 그려져 끌기가 뚝뚝 끊겼다.
  const dragMovedRef = useRef(false)
  const onSwapSplitRef = useRef(onSwapSplit)
  onSwapSplitRef.current = onSwapSplit
  useLayoutEffect(() => {
    if (sidebarUserSized) return
    const actions = shellRef.current?.querySelector('.topbar-leftcluster-actions')
    if (actions == null) return
    // 사이드바 칸(폭 + 구분선 1px)이 단추 묶음과 같은 폭이 되게 한다
    const measure = () => {
      // 사이드바를 접어 보기 탭이 숨은 동안의 폭으로는 맞추지 않는다
      if (actions.querySelector('.topbar-side-tabs') === null) return
      const width = Math.ceil(actions.getBoundingClientRect().width)
      if (width > 0) setFitSidebarPx(clampSidebar(width - 1))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(actions)
    return () => observer.disconnect()
  }, [sidebarUserSized])

  const layoutRef = useRef({ sidebarPx, leftFrac: leftFracRef.current })
  layoutRef.current = { sidebarPx, leftFrac: leftFracRef.current }

  // 경계선을 끄는 동안의 비율(나누기 id → 비율). 놓을 때 한 번만 바깥(onRootChange)에 알린다
  const [liveRatios, setLiveRatios] = useState<Readonly<Record<string, number>>>({})
  const liveRatiosRef = useRef<Readonly<Record<string, number>>>({})
  const rootRef = useRef(root)
  rootRef.current = root
  const onRootChangeRef = useRef(onRootChange)
  onRootChangeRef.current = onRootChange
  const shownRoot = useMemo(() => (Object.keys(liveRatios).length === 0 ? root : applyRatios(root, liveRatios)), [root, liveRatios])

  /**
   * 구분선 하나의 드래그를 시작한다. 구분선들이 같은 수명주기를 쓰므로
   * 규칙도 한 곳에만 적는다 — 끝나는 조건이 갈라지면 한쪽만 안 끝난다.
   *
   * 드래그가 끝나는 사건은 셋이다. pointerup 은 정상 종료이고,
   * pointercancel 은 브라우저가 포인터를 빼앗아 갈 때(터치가 스크롤로
   * 승격, 펜이 화면을 떠남) 온다. lostpointercapture 는 캡처가 풀린
   * 순간이라 그 뒤의 pointermove 는 더 이상 우리 드래그가 아니다.
   * 셋 중 하나라도 놓치면 버튼을 뗀 뒤에도 pointermove 리스너가 살아
   * 남아 구분선이 마우스를 따라다닌다 — 다음 pointerdown 까지.
   */
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, onMove: (clientX: number, clientY: number) => void, onEnd?: () => void, rowCursor = false) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragController.current?.abort()
      const controller = new AbortController()
      dragController.current = controller
      const { signal } = controller
      let frame: number | null = null
      let pending: { x: number; y: number } | null = null
      // 조금이라도(3px) 움직였으면 끌기다. 경계선 위 「바꾸기」 단추는 끌지 않고 뗐을 때만 눌린 것으로 친다
      const startX = e.clientX
      const startY = e.clientY
      dragMovedRef.current = false
      const flush = () => {
        frame = null
        if (pending !== null) onMove(pending.x, pending.y)
        pending = null
      }
      document.body.classList.add('pane-resizing')
      if (rowCursor) document.body.classList.add('pane-resizing-row')
      // 프레임의 첫 움직임은 바로 반영하고, 같은 프레임 안에 더 온 것은 다음 프레임에 마지막 값 하나로 합친다
      window.addEventListener('pointermove', (ev) => {
        if (!dragMovedRef.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        dragMovedRef.current = true
        if (frame === null) {
          onMove(ev.clientX, ev.clientY)
          frame = requestAnimationFrame(flush)
          return
        }
        pending = { x: ev.clientX, y: ev.clientY }
      }, { signal })
      let released = false
      const finish = (event: Event) => {
        if (signal.aborted) return
        // 정상으로 뗀 것(pointerup)만 단추 누름으로 친다. 브라우저가 포인터를 빼앗은 경우는 아니다
        released = event.type === 'pointerup'
        if (frame !== null) cancelAnimationFrame(frame)
        flush()
        controller.abort()
      }
      // 「바꾸기」 단추 위에서 눌러 끌지 않고 뗐으면 바꾸기다
      const swapSplit = (e.target as Element | null)?.closest<HTMLElement>('.pane-swap-btn')?.dataset.swapSplit
      signal.addEventListener('abort', () => {
        if (swapSplit !== undefined && released && !dragMovedRef.current) onSwapSplitRef.current?.(swapSplit)
        document.body.classList.remove('pane-resizing', 'pane-resizing-row')
        onEnd?.()
        onLayoutChange?.(layoutRef.current)
        // 끄는 동안 미뤄 둔 PDF 폭 맞춤을 이제 한다
        window.dispatchEvent(new Event('iwae:pane-resize-end'))
      })
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        window.addEventListener(end, finish, { signal })
      }
    },
    [onLayoutChange],
  )

  const dragSidebar = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      startDrag(e, (clientX) => {
        const nextSidebarPx = clampSidebar(clientX)
        layoutRef.current = { ...layoutRef.current, sidebarPx: nextSidebarPx }
        setSidebarPx(nextSidebarPx)
        setSidebarUserSized(true)
        writeSidebarUserSized()
      })
    },
    [startDrag],
  )

  /** 경계선(나누기 하나)을 끈다: 포인터 자리에서 그 나누기가 차지한 사각형 안의 몫을 구해 비율로 삼는다 */
  const dragSplit = useCallback(
    (splitId: string) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      startDrag(
        e,
        (clientX, clientY) => {
          const element = panesRef.current
          const outer = element?.getBoundingClientRect()
          // 칸 영역은 가장자리 테두리(바깥 여백)를 뺀 안쪽 사각형이다 — 칸 사각형 %는 그 안쪽 기준이다
          const inner = element != null && element.clientWidth > 0 && element.clientHeight > 0
          const box = element == null || outer === undefined ? undefined : inner ? { left: outer.left + element.clientLeft, top: outer.top + element.clientTop, width: element.clientWidth, height: element.clientHeight } : outer
          const split = layoutRects(applyRatios(rootRef.current, liveRatiosRef.current)).splits.find((item) => item.id === splitId)
          if (box === undefined || split === undefined || box.width <= 0 || box.height <= 0) return
          const horizontal = split.dir === 'h'
          const start = horizontal ? box.left + split.x * box.width : box.top + split.y * box.height
          const total = (horizontal ? split.w * box.width : split.h * box.height)
          if (total <= 0) return
          const ratio = clampRatioForSize(split.node, ((horizontal ? clientX : clientY) - start) / total, total)
          liveRatiosRef.current = { ...liveRatiosRef.current, [splitId]: ratio }
          setLiveRatios(liveRatiosRef.current)
        },
        () => {
          const ratios = liveRatiosRef.current
          liveRatiosRef.current = {}
          setLiveRatios({})
          if (Object.keys(ratios).length > 0) onRootChangeRef.current?.(applyRatios(rootRef.current, ratios))
        },
        layoutRects(rootRef.current).splits.find((item) => item.id === splitId)?.dir === 'v',
      )
    },
    [startDrag],
  )

  /** 경계선 가운데의 「양쪽 바꾸기」 단추. 누름은 경계선으로 그대로 올라가 끌기를 시작하고, 끌지 않고 떼면 바꾼다 */
  const swapButton = (splitId: string) => onSwapSplit === undefined || focusedPane !== 'split' ? null : (
    <button
      type="button"
      className="pane-swap-btn"
      aria-label={t('양쪽 패널 바꾸기')}
      title={t('양쪽 바꾸기')}
      data-swap-split={splitId}
      // 경계선이 포인터를 잡으므로 click 은 오지 않는다. 끌지 않고 뗐는지는 startDrag 가 보고 바꾼다.
      // 키보드(Enter·Space)로 누른 것만 여기서 받는다
      onClick={(event) => {
        if (event.detail === 0) onSwapSplit(splitId)
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M5 3 2 6l3 3M2 6h9M11 7l3 3-3 3M14 10H5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )

  const zoomed = focusedPane === 'zoom' && zoomedPane !== null
  const sidebarHidden = sidebarCollapsed || focusedPane !== 'split'
  const order = leaves(shownRoot)
  const multi = order.length > 1
  const rects = useMemo(() => layoutRects(shownRoot), [shownRoot])

  // 칸 영역의 안쪽 크기(px): 떠 있는 칸의 자리는 붙은 곳(화면 · 칸)의 사각형에 대한 비율이라 px 로 바꾸려면 필요하다
  const [panesSize, setPanesSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = panesRef.current
    if (element === null) return undefined
    const measure = () => setPanesSize((current) => (current.width === element.clientWidth && current.height === element.clientHeight ? current : { width: element.clientWidth, height: element.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  /** 붙은 곳의 사각형. 크게 보는 중에 숨은 칸에 붙은 떠 있는 칸은 그리지 않는다(null) */
  const anchorRect = (anchor: FloatAnchor): AnchorRect | null => {
    if (anchor.kind === 'screen') return { left: 0, top: 0, width: panesSize.width, height: panesSize.height }
    const unit = zoomed ? (anchor.paneId === zoomedPane ? FULL : null) : rects.panes.get(anchor.paneId) ?? null
    if (unit === null) return null
    return { left: unit.x * panesSize.width, top: unit.y * panesSize.height, width: unit.w * panesSize.width, height: unit.h * panesSize.height }
  }

  // 모드가 바뀌는 동안만 shell-transitioning 을 붙인다. 폭이 움직이는
  // 230ms 동안 무거운 자식(PDF 캔버스)이 매 프레임 다시 그리지 않도록
  // 이 표시를 보고 판단할 수 있다.
  const modeKey = `${focusedPane}|${zoomedPane}|${sidebarCollapsed}|${libraryExpanded}|${paneCount(shownRoot)}`
  const previousModeKey = useRef(modeKey)
  const [transitioning, setTransitioning] = useState(false)
  useEffect(() => {
    if (previousModeKey.current === modeKey) return
    previousModeKey.current = modeKey
    setTransitioning(true)
    const timer = window.setTimeout(() => setTransitioning(false), TRANSITION_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [modeKey])

  const shellClassName = [
    'shell',
    // 라이브러리는 접힌 사이드바도 펼쳐 보인다. 접힘 표시가 남으면
    // .shell-sidebar-collapsed .sidebar { pointer-events: none } 때문에 아무것도 눌리지 않는다.
    sidebarCollapsed ? 'shell-sidebar-collapsed' : '',
    focusedPane === 'zoom' ? 'shell-reader-focused' : '',
    libraryExpanded ? 'shell-library-expanded' : '',
    transitioning ? 'shell-transitioning' : '',
  ].filter(Boolean).join(' ')
  const appClassName = [
    'app',
    focusedPane === 'zoom' ? 'app-reader-focused' : '',
    !multi ? 'app-single-pane' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={shellRef}
      className={shellClassName}
      style={{
        '--sidebar-width': sidebarHidden ? '0px' : `${sidebarPx}px`,
        '--sidebar-divider-width': sidebarHidden ? '0px' : '1px',
      } as CSSProperties}
    >
      {topBar({ sidebarPx, leftFrac: 1, sidebarVisible: !sidebarHidden })}
      <div className={appClassName}>
        <div className="sidebar" aria-hidden={sidebarHidden} inert={sidebarHidden}>
          {sidebar}
        </div>
        {(
          <div
            className="divider sidebar-divider"
            role={sidebarHidden ? undefined : 'separator'}
            aria-orientation="vertical"
            aria-label={t('사이드바 너비 조절')}
            aria-hidden={sidebarHidden}
            onPointerDown={sidebarHidden ? undefined : dragSidebar}
          />
        )}
        <div
          ref={panesRef}
          className="panes panes-tree"
          data-pane-count={order.length}
          inert={libraryExpanded}
          aria-hidden={libraryExpanded || undefined}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget.firstElementChild) setTransitioning(false)
          }}
        >
          {order.map((paneId, index) => {
            const rect = zoomed ? (paneId === zoomedPane ? FULL : null) : rects.panes.get(paneId) ?? null
            const hidden = rect === null
            const style: CSSProperties = hidden
              ? { left: 0, top: 0, width: 0, height: 0 }
              : { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }
            return (
              <div
                key={`${epoch}:${paneId}`}
                className={`pane pane-grid-cell${hidden ? ' pane-zoom-hidden' : ''}`}
                data-pane-index={index}
                style={style}
                aria-hidden={hidden || undefined}
                inert={hidden}
              >
                {/* 칸 하나 = 둥근 카드 하나(머리 + 본문). 칸 사이 틈은 CSS 가 낸다 */}
                <div className="pane-card">
                  {renderHead !== undefined ? <div className="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head={paneId}>{renderHead(paneId, index)}</div> : null}
                  <div className="pane-grid-body">{renderPane(paneId, index)}</div>
                </div>
              </div>
            )
          })}
          {zoomed ? null : rects.splits.map((split) => {
            const horizontal = split.dir === 'h'
            const style: CSSProperties = horizontal
              ? { left: `${(split.x + split.w * split.ratio) * 100}%`, top: `${split.y * 100}%`, height: `${split.h * 100}%` }
              : { top: `${(split.y + split.h * split.ratio) * 100}%`, left: `${split.x * 100}%`, width: `${split.w * 100}%` }
            return (
              <div
                key={split.id}
                className={`pane-grid-divider pane-tree-divider pane-grid-divider-${horizontal ? 'col' : 'row'}`}
                role="separator"
                aria-orientation={horizontal ? 'vertical' : 'horizontal'}
                aria-label={t('패널 너비 조절')}
                data-split-id={split.id}
                style={style}
                onPointerDown={dragSplit(split.id)}
              >
                {swapButton(split.id)}
              </div>
            )
          })}
          {floats.length === 0 ? null : (
            <FloatLayer
              floats={floats}
              anchorRect={anchorRect}
              screenRect={{ left: 0, top: 0, width: panesSize.width, height: panesSize.height }}
              epoch={epoch}
              renderHead={(paneId) => (renderFloatHead ?? ((id) => renderHead?.(id, -1)))(paneId)}
              renderBody={(paneId) => renderPane(paneId, -1)}
              onChange={(paneId, patch) => onFloatChange?.(paneId, patch)}
              onRaise={(paneId) => onFloatRaise?.(paneId)}
            />
          )}
        </div>
        {libraryExpanded ? <div ref={onLibraryHost} className="library-host" /> : null}
        {/* 작업 공간 층: 문서 창과 이웃한 메모 노트 창 사이의 연결선을 모든 칸 위에 그린다(포인터는 지나간다) */}
        {libraryExpanded ? null : <WorkspaceLinkLayer />}
      </div>
      {statusBar}
    </div>
  )
}

const SIDEBAR_USER_SIZED_KEY = 'iwae:sidebar-user-sized:v1'

/** 사용자가 사이드바 폭을 직접 조절한 적이 있는가(한 번 조절하면 그 폭을 계속 쓴다) */
function readSidebarUserSized(): boolean {
  try { return window.localStorage.getItem(SIDEBAR_USER_SIZED_KEY) === '1' } catch { return false }
}

function writeSidebarUserSized(): void {
  try { window.localStorage.setItem(SIDEBAR_USER_SIZED_KEY, '1') } catch { /* 이번 실행에만 */ }
}
