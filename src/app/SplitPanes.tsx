import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { SIDEBAR_DEFAULT, clampLeftFrac, clampSidebar, fracFromPointer } from './splitLayout'
import { evenFractions, fractionOffset, moveSplitBoundary, splitDividers, type PdfSplitLayout } from '../core/pdfSplit'
import '../ui/layout-transitions.css'
import { t } from '../i18n'

/** 어느 패널이 화면을 차지하는가. note·reader 는 반대쪽 패널과 사이드바를 접는다 */
export type FocusedPane = 'split' | 'note' | 'reader'

/** transitionend 가 오지 않을 때(애니메이션 줄이기, 숨은 창) 전환 표시를 끄는 상한 */
const TRANSITION_FALLBACK_MS = 400

interface SplitPanesProps {
  sidebar: React.ReactNode
  /**
   * 창 맨 윗줄. 사이드바 위를 포함해 전체 폭을 가로지른다.
   *
   * 값이 아니라 함수인 이유: 상단바가 이제 두 패널의 탭바를 얹고, 그
   * 탭바 구역의 너비를 sidebarPx·leftFrac 과 맞춰야 아래 실제 패널
   * 경계와 같은 자리에서 갈린다. 그 두 값의 주인은 이 컴포넌트의 드래그
   * 상태이므로, 렌더 시점에 여기서 건네준다.
   */
  topBar: (layout: { sidebarPx: number; leftFrac: number; sidebarVisible: boolean; paneGrows: readonly [number, number, number] }) => React.ReactNode
  /** 사이드바를 접었는가. 접으면 사이드바와 그 구분선이 함께 사라진다 */
  sidebarCollapsed: boolean
  layout?: { sidebarPx: number; leftFrac: number }
  onLayoutChange?: (layout: { sidebarPx: number; leftFrac: number }) => void
  focusedPane?: FocusedPane
  /**
   * 라이브러리 모드. 사이드바가 작업 영역 전체로 펼쳐지고 두 패널은
   * 마운트된 채 가려진다 — 돌아왔을 때 PDF 위치와 캔버스 상태가 그대로다.
   */
  libraryExpanded?: boolean
  /** 1단 보기. 오른쪽 패널과 가운데 구분선을 접고 왼쪽 패널이 작업 영역을 다 쓴다 */
  singlePane?: boolean
  /** 3단 보기. 있으면 오른쪽에 세 번째 패널을 둔다(singlePane 보다 뒤에 본다) */
  threePane?: boolean
  left: React.ReactNode
  right: React.ReactNode
  third?: React.ReactNode
  /** 넷(2×2) 배치의 네 번째 패널 */
  fourth?: React.ReactNode
  /**
   * 격자 배치(위아래·2×2 등). 주면 패널을 격자로 놓고, 패널마다 바로 위에 그 패널의 탭 줄을 둔다
   * (좌우로만 나눌 때는 탭이 상단바에 있다). 칸 차례는 left → right → third → fourth
   */
  grid?: { readonly layout: PdfSplitLayout; readonly tabs: readonly React.ReactNode[] }
  /**
   * 칸막이에 마우스를 올리면 나오는 「양쪽 바꾸기」 단추. 0 = 왼쪽↔오른쪽(3단이면 가운데), 1 = 가운데↔맨 오른쪽.
   * 단추를 누른 채 끌면 단추가 아니라 칸막이 끌기다(폭 조정을 막지 않는다).
   */
  onSwapPanes?: (boundary: 0 | 1) => void
}

/** 3단의 두 구분선 자리(작업 영역 폭에 대한 비율). 다음 실행에도 기억한다 */
const THREE_FRACS_KEY = 'iwae:pane-fracs3:v1'
const THREE_MIN = 0.12
function readThreeFracs(): readonly [number, number] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(THREE_FRACS_KEY) ?? 'null')
    if (Array.isArray(raw) && typeof raw[0] === 'number' && typeof raw[1] === 'number') return clampThree(raw[0], raw[1])
  } catch { /* 기본값 */ }
  return [1 / 3, 2 / 3]
}
function clampThree(a: number, b: number): readonly [number, number] {
  const first = Math.min(Math.max(a, THREE_MIN), 1 - THREE_MIN * 2)
  const second = Math.min(Math.max(b, first + THREE_MIN), 1 - THREE_MIN)
  return [first, second]
}

/**
 * 사이드바 | 좌 | 우 3분할. 구분선 두 개를 드래그해 폭을 바꾼다.
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
  libraryExpanded = false,
  singlePane = false,
  threePane = false,
  left,
  right,
  third,
  fourth,
  grid,
  onSwapPanes,
}: SplitPanesProps) {
  const [sidebarPx, setSidebarPx] = useState(() => clampSidebar(layout?.sidebarPx ?? SIDEBAR_DEFAULT))
  const [leftFrac, setLeftFrac] = useState(() => clampLeftFrac(layout?.leftFrac ?? 0.5))
  const panesRef = useRef<HTMLDivElement>(null)
  const dragController = useRef<AbortController | null>(null)

  useEffect(() => () => dragController.current?.abort(), [])

  useEffect(() => {
    if (layout === undefined) return
    setSidebarPx(clampSidebar(layout.sidebarPx))
    setLeftFrac(clampLeftFrac(layout.leftFrac))
  }, [layout])

  /**
   * 구분선 하나의 드래그를 시작한다. 두 구분선이 같은 수명주기를 쓰므로
   * 규칙도 한 곳에만 적는다 — 끝나는 조건이 갈라지면 한쪽만 안 끝난다.
   *
   * 드래그가 끝나는 사건은 셋이다. pointerup 은 정상 종료이고,
   * pointercancel 은 브라우저가 포인터를 빼앗아 갈 때(터치가 스크롤로
   * 승격, 펜이 화면을 떠남) 온다. lostpointercapture 는 캡처가 풀린
   * 순간이라 그 뒤의 pointermove 는 더 이상 우리 드래그가 아니다.
   * 셋 중 하나라도 놓치면 버튼을 뗀 뒤에도 pointermove 리스너가 살아
   * 남아 구분선이 마우스를 따라다닌다 — 다음 pointerdown 까지.
   */
  // 끄는 동안의 최신 값. 화면은 프레임마다 한 번만 고치고, 바깥(App 전체를 다시 그리는 onLayoutChange)에는
  // 놓을 때 한 번만 알린다 — 예전에는 포인터가 움직일 때마다 App 전체가 다시 그려져 끌기가 뚝뚝 끊겼다.
  const dragMovedRef = useRef(false)
  const onSwapPanesRef = useRef(onSwapPanes)
  onSwapPanesRef.current = onSwapPanes
  const layoutRef = useRef({ sidebarPx, leftFrac })
  layoutRef.current = { sidebarPx, leftFrac }
  const [threeFracs, setThreeFracs] = useState(readThreeFracs)
  const threeFracsRef = useRef(threeFracs)
  threeFracsRef.current = threeFracs
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, onMove: (clientX: number) => void) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragController.current?.abort()
      const controller = new AbortController()
      dragController.current = controller
      const { signal } = controller
      let frame: number | null = null
      let pendingX: number | null = null
      // 조금이라도(3px) 움직였으면 끌기다. 칸막이 위 「바꾸기」 단추는 끌지 않고 뗐을 때만 눌린 것으로 친다
      const startX = e.clientX
      dragMovedRef.current = false
      const flush = () => {
        frame = null
        if (pendingX !== null) onMove(pendingX)
        pendingX = null
      }
      document.body.classList.add('pane-resizing')
      // 프레임의 첫 움직임은 바로 반영하고, 같은 프레임 안에 더 온 것은 다음 프레임에 마지막 값 하나로 합친다
      window.addEventListener('pointermove', (ev) => {
        if (!dragMovedRef.current && Math.abs(ev.clientX - startX) < 3) return
        dragMovedRef.current = true
        if (frame === null) {
          onMove(ev.clientX)
          frame = requestAnimationFrame(flush)
          return
        }
        pendingX = ev.clientX
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
      const swapBoundary = (e.target as Element | null)?.closest<HTMLElement>('.pane-swap-btn')?.dataset.swapBoundary
      signal.addEventListener('abort', () => {
        if (swapBoundary !== undefined && released && !dragMovedRef.current) onSwapPanesRef.current?.(swapBoundary === '1' ? 1 : 0)
        document.body.classList.remove('pane-resizing')
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
      })
    },
    [startDrag],
  )

  const dragPanes = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      startDrag(e, (clientX) => {
        const box = panesRef.current?.getBoundingClientRect()
        if (!box) return
        const nextLeftFrac = fracFromPointer(clientX, box.left, box.width)
        layoutRef.current = { ...layoutRef.current, leftFrac: nextLeftFrac }
        setLeftFrac(nextLeftFrac)
      })
    },
    [startDrag],
  )

  /** 3단의 구분선(0 = 왼쪽|가운데, 1 = 가운데|오른쪽)을 끈다 */
  const dragThree = useCallback(
    (which: 0 | 1) => (e: React.PointerEvent<HTMLDivElement>) => {
      startDrag(e, (clientX) => {
        const box = panesRef.current?.getBoundingClientRect()
        if (!box || box.width <= 0) return
        const at = (clientX - box.left) / box.width
        const [a, b] = threeFracsRef.current
        const next = which === 0 ? clampThree(at, b) : clampThree(a, at)
        threeFracsRef.current = next
        setThreeFracs(next)
        try { window.localStorage.setItem(THREE_FRACS_KEY, JSON.stringify(next)) } catch { /* 이번 실행에만 */ }
      })
    },
    [startDrag],
  )

  /** 칸막이 가운데의 「양쪽 바꾸기」 단추. 누름은 칸막이로 그대로 올라가 끌기를 시작하고, 끌지 않고 떼면 바꾼다 */
  const swapButton = (boundary: 0 | 1) => onSwapPanes === undefined || singlePane || focusedPane !== 'split' ? null : (
    <button
      type="button"
      className="pane-swap-btn"
      aria-label={boundary === 0 ? t('양쪽 패널 바꾸기') : t('가운데·오른쪽 패널 바꾸기')}
      title={t('양쪽 바꾸기')}
      data-swap-boundary={boundary}
      // 칸막이가 포인터를 잡으므로 click 은 오지 않는다. 끌지 않고 뗐는지는 startDrag 가 보고 바꾼다.
      // 키보드(Enter·Space)로 누른 것만 여기서 받는다
      onClick={(event) => {
        if (event.detail === 0) onSwapPanes(boundary)
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M5 3 2 6l3 3M2 6h9M11 7l3 3-3 3M14 10H5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )

  const sidebarHidden = !libraryExpanded && (sidebarCollapsed || focusedPane !== 'split')
  const three = threePane && !singlePane && focusedPane === 'split'
  const leftGrow = singlePane ? 1 : focusedPane === 'note' ? 0 : focusedPane === 'reader' ? 1 : three ? threeFracs[0] : leftFrac
  const rightGrow = singlePane ? 0 : focusedPane === 'reader' ? 0 : focusedPane === 'note' ? 1 : three ? threeFracs[1] - threeFracs[0] : 1 - leftFrac
  const thirdGrow = three ? 1 - threeFracs[1] : 0

  // 모드가 바뀌는 동안만 shell-transitioning 을 붙인다. 폭이 움직이는
  // 230ms 동안 무거운 자식(PDF 캔버스)이 매 프레임 다시 그리지 않도록
  // 이 표시를 보고 판단할 수 있다.
  const modeKey = `${focusedPane}|${sidebarCollapsed}|${libraryExpanded}|${singlePane}|${three}`
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
    sidebarCollapsed && !libraryExpanded ? 'shell-sidebar-collapsed' : '',
    focusedPane === 'note' ? 'shell-note-focused' : '',
    focusedPane === 'reader' ? 'shell-reader-focused' : '',
    libraryExpanded ? 'shell-library-expanded' : '',
    transitioning ? 'shell-transitioning' : '',
  ].filter(Boolean).join(' ')
  const appClassName = [
    'app',
    focusedPane === 'note' ? 'app-note-focused' : '',
    focusedPane === 'reader' || singlePane ? 'app-reader-focused' : '',
    singlePane ? 'app-single-pane' : '',
    three ? 'app-three-pane' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={shellClassName}
      style={{
        '--sidebar-width': libraryExpanded ? '100%' : sidebarHidden ? '0px' : `${sidebarPx}px`,
        '--sidebar-divider-width': libraryExpanded || sidebarHidden ? '0px' : '1px',
      } as CSSProperties}
    >
      {topBar({
        sidebarPx,
        leftFrac: leftGrow,
        sidebarVisible: !sidebarHidden && !libraryExpanded,
        paneGrows: [leftGrow, rightGrow, thirdGrow],
      })}
      <div className={appClassName}>
        <div className="sidebar" aria-hidden={sidebarHidden} inert={sidebarHidden}>
          {sidebar}
        </div>
        {libraryExpanded ? null : (
          <div
            className="divider sidebar-divider"
            role={sidebarHidden ? undefined : 'separator'}
            aria-orientation="vertical"
            aria-label={t('사이드바 너비 조절')}
            aria-hidden={sidebarHidden}
            onPointerDown={sidebarHidden ? undefined : dragSidebar}
          />
        )}
        {grid !== undefined ? (
          <GridPanes layout={grid.layout} tabs={grid.tabs} cells={[left, right, third, fourth]} hidden={libraryExpanded} />
        ) : (
        <div
          className="panes"
          ref={panesRef}
          inert={libraryExpanded}
          aria-hidden={libraryExpanded || undefined}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget.firstElementChild) setTransitioning(false)
          }}
        >
          <div
            className="pane pane-left"
            style={{ flexGrow: leftGrow }}
            aria-hidden={focusedPane === 'note'}
            inert={focusedPane === 'note'}
          >
            {left}
          </div>
          <div
            className="divider pane-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('패널 너비 조절')}
            onPointerDown={three ? dragThree(0) : dragPanes}
          >
            {swapButton(0)}
          </div>
          <div
            className="pane pane-right"
            style={{ flexGrow: rightGrow }}
            aria-hidden={focusedPane === 'reader' || singlePane}
            inert={focusedPane === 'reader' || singlePane}
          >
            {right}
          </div>
          <div
            className="divider pane-divider pane-divider-third"
            role={three ? 'separator' : undefined}
            aria-orientation="vertical"
            aria-label={t('가운데·오른쪽 패널 너비 조절')}
            aria-hidden={!three}
            onPointerDown={three ? dragThree(1) : undefined}
          >
            {three ? swapButton(1) : null}
          </div>
          <div
            className="pane pane-third"
            style={{ flexGrow: thirdGrow }}
            aria-hidden={!three}
            inert={!three}
          >
            {third}
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

/** 격자 칸 비율(배치마다). 다음 실행에도 기억한다 */
function readGridFractions(layout: PdfSplitLayout): { cols: number[]; rows: number[] } {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(`iwae:pane-grid:v1:${layout.id}`) ?? 'null')
    if (typeof raw === 'object' && raw !== null) {
      const { cols, rows } = raw as { cols?: unknown; rows?: unknown }
      const ok = (value: unknown, count: number): value is number[] => Array.isArray(value) && value.length === count && value.every((n) => typeof n === 'number' && n > 0)
      if (ok(cols, layout.cols) && ok(rows, layout.rows)) return { cols, rows }
    }
  } catch { /* 기본값 */ }
  return { cols: evenFractions(layout.cols), rows: evenFractions(layout.rows) }
}

/**
 * 앱 창 격자 나누기(PDF 안 화면 나누기와 같은 배치). 칸마다 맨 위에 그 패널의 탭 줄, 아래에 패널 내용.
 * 칸 사이 선을 끌어 크기를 바꾼다.
 */
function GridPanes({ layout, tabs, cells, hidden }: { readonly layout: PdfSplitLayout; readonly tabs: readonly React.ReactNode[]; readonly cells: readonly React.ReactNode[]; readonly hidden: boolean }) {
  const [fractions, setFractions] = useState(() => readGridFractions(layout))
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setFractions(readGridFractions(layout)) }, [layout])
  const dragDivider = (axis: 'col' | 'row', boundary: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    document.body.classList.add('pane-resizing')
    let latest = fractions
    const move = (moveEvent: PointerEvent) => {
      const box = rootRef.current?.getBoundingClientRect()
      if (box === undefined || box.width <= 0 || box.height <= 0) return
      const at = axis === 'col' ? (moveEvent.clientX - box.left) / box.width : (moveEvent.clientY - box.top) / box.height
      latest = axis === 'col'
        ? { ...latest, cols: moveSplitBoundary(latest.cols, boundary, at) }
        : { ...latest, rows: moveSplitBoundary(latest.rows, boundary, at) }
      setFractions(latest)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.body.classList.remove('pane-resizing')
      try { window.localStorage.setItem(`iwae:pane-grid:v1:${layout.id}`, JSON.stringify(latest)) } catch { /* 이번 실행에만 */ }
      window.dispatchEvent(new Event('iwae:pane-resize-end'))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  return (
    <div
      ref={rootRef}
      className="panes panes-grid"
      data-pane-layout={layout.id}
      inert={hidden}
      aria-hidden={hidden || undefined}
      style={{
        gridTemplateColumns: fractions.cols.map((value) => `minmax(0, ${value}fr)`).join(' '),
        gridTemplateRows: fractions.rows.map((value) => `minmax(0, ${value}fr)`).join(' '),
      }}
    >
      {layout.cells.map((place, index) => (
        <div
          key={index}
          className={`pane pane-grid-cell pane-grid-cell-${index}`}
          style={{ gridColumn: `${place.col + 1} / span ${place.colSpan}`, gridRow: `${place.row + 1} / span ${place.rowSpan}` }}
        >
          <div className="pane-grid-tabs">{tabs[index]}</div>
          <div className="pane-grid-body">{cells[index]}</div>
        </div>
      ))}
      {splitDividers(layout).map((divider) => {
        const across = divider.axis === 'col' ? fractions.rows : fractions.cols
        const along = divider.axis === 'col' ? fractions.cols : fractions.rows
        const position = fractionOffset(along, divider.boundary)
        const start = fractionOffset(across, divider.start)
        const end = fractionOffset(across, divider.end)
        const style: CSSProperties = divider.axis === 'col'
          ? { left: `${position * 100}%`, top: `${start * 100}%`, height: `${(end - start) * 100}%` }
          : { top: `${position * 100}%`, left: `${start * 100}%`, width: `${(end - start) * 100}%` }
        return (
          <div
            key={`${divider.axis}-${divider.boundary}-${divider.start}`}
            className={`pane-grid-divider pane-grid-divider-${divider.axis}`}
            role="separator"
            aria-orientation={divider.axis === 'col' ? 'vertical' : 'horizontal'}
            aria-label={t('패널 크기 조절')}
            style={style}
            onPointerDown={dragDivider(divider.axis, divider.boundary)}
          />
        )
      })}
    </div>
  )
}

