import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { buildAnchor, coalesceHighlightRects, type Anchor, type AnchorRect } from '../core/anchor'
import { announceAction } from '../app/actionFeedback'
import {
  createRegionExcerptSelection,
  createTextExcerptSelection,
  type PdfExcerptSelection,
} from '../core/pdfExcerpt'
import type { PageTextIndex } from '../core/textIndex'
import { selectionRange } from './selection'
import { estimateSelectionTextHeight } from './visualTextHeight'
import { detectSelectionTextHeight, recognizeSelectionText } from './ocrTextDetector'
import { getAppPrefs } from '../app/appPrefs'
import { SelectionActions, type PdfSelectionTranslation } from './SelectionActions'
import { ContextMenu } from '../ui/ContextMenu'
import { documentContextEntries } from '../ui/documentContextMenu'
import {
  createPersistentPdfHighlight,
  type PdfHighlightColor,
  type PersistentPdfHighlight,
} from './persistentHighlight'
import { t } from '../i18n'
import { isFreshHighlight } from './freshHighlight'
import { menuGuardActive } from '../app/menuGuard'

export type { PdfHighlightColor } from './persistentHighlight'

interface Point {
  readonly x: number
  readonly y: number
}

/** 표·그림(영역) 네모의 어느 변을 잡았는가 */
interface RegionEdges {
  readonly left: boolean
  readonly right: boolean
  readonly top: boolean
  readonly bottom: boolean
}

interface RegionResize {
  readonly id: string
  readonly pointerId: number
  readonly edges: RegionEdges
  /** 잡기 시작할 때 네모(PDF 좌표) */
  readonly start: AnchorRect
  readonly from: Point
}

const RESIZE_GRIP_PX = 6
const MIN_REGION_PT = 8

function edgeCursor(edges: RegionEdges): string {
  if ((edges.left && edges.top) || (edges.right && edges.bottom)) return 'nwse-resize'
  if ((edges.right && edges.top) || (edges.left && edges.bottom)) return 'nesw-resize'
  return edges.left || edges.right ? 'ew-resize' : 'ns-resize'
}

/** 잡은 변을 끈 만큼 옮긴 네모(PDF 좌표). 너무 작아지거나 뒤집히지 않게 */
export function resizedRegion(start: AnchorRect, edges: RegionEdges, dx: number, dy: number, pageSize: readonly [number, number]): AnchorRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (edges.left) left = Math.min(Math.max(left + dx, 0), right - MIN_REGION_PT)
  if (edges.right) right = Math.max(Math.min(right + dx, pageSize[0]), left + MIN_REGION_PT)
  if (edges.top) top = Math.min(Math.max(top + dy, 0), bottom - MIN_REGION_PT)
  if (edges.bottom) bottom = Math.max(Math.min(bottom + dy, pageSize[1]), top + MIN_REGION_PT)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

interface SelectionGesture {
  readonly pointerId: number
  readonly button: 0 | 2
  readonly mode: 'text' | 'region'
  readonly from: Point
}

/** hand: 다른 PDF 뷰어의 손 도구. 글자 위에서 끌면 글을 고르고, 빈 곳에서 끌면 화면을 잡아 옮긴다(PdfPane 이 옮긴다) */
export type PdfInteractionMode = 'text' | 'lasso' | 'highlight' | 'hand' | 'box' | 'edit'

/** 이 점(화면 px) 바로 아래나 아주 가까이에 글자가 있는가. 손 도구에서 「글 고르기」와 「화면 옮기기」를 가른다 */
export function textNearPoint(index: PageTextIndex, renderScale: number, point: Point): boolean {
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1
  const x = point.x / scale
  const y = point.y / scale
  return index.chars.some((box) => box.w > 0 && box.h > 0
    && x >= box.x - 2 && x <= box.x + box.w + 2
    && y >= box.y - box.h * 0.25 && y <= box.y + box.h * 1.25)
}
interface SelectionLayerProps {
  docId: string
  page: number
  index: PageTextIndex
  renderScale: number
  width: number
  height: number
  sourceTitle: string
  pageSize: readonly [number, number]
  mode?: PdfInteractionMode
  highlightColor?: PdfHighlightColor
  anchor?: Anchor
  persistentHighlights?: readonly PersistentPdfHighlight[]
  /**
   * 지금 노트 바에 없는 형광펜(id → 마우스를 올렸을 때 보일 말). 흐리게 그리거나(dim) 아예 그리지 않는다(hide).
   * 없애면(null·생략) 모두 보통으로 그린다
   */
  otherNote?: { readonly mode: 'dim' | 'hide'; readonly labels: ReadonlyMap<string, string>; /** 말풍선 둘째 줄: 그 메모의 글(없으면 줄이 없다) */ readonly bodies?: ReadonlyMap<string, string> } | null
  passiveHighlights?: readonly { blockId: string; anchor: Anchor }[]
  searchHighlights?: readonly { id: string; rects: Anchor['rects']; active: boolean }[]
  onAnchorCreated?: (anchor: Anchor) => void
  onPersistentHighlightCreated?: (highlight: PersistentPdfHighlight) => void
  onPersistentHighlightRemoved?: (highlightId: string) => void
  eraseHighlights?: boolean
  /** 이 값이 바뀌면 고른 것과 작업 메뉴를 내린다(고른 것이 메모가 된 뒤 등) */
  resetKey?: number
  /** 잠깐 깜빡여 위치를 알려 줄 형광펜(주석 패널에서 고른 것) */
  flashHighlightId?: string | null
  /** 텍스트 모드에서 형광펜을 클릭했다(끌지 않고). 화면 좌표를 함께 넘긴다 */
  onPersistentHighlightActivate?: (highlightId: string, point: { x: number; y: number }) => void
  /** 형광펜 위에 마우스를 올렸다(그 id) / 형광펜을 벗어났다(null). 올린 것이 바뀔 때만 부른다 */
  onPersistentHighlightHover?: (highlightId: string | null) => void
  /** 텍스트·영역 캡처 도구에서 표·그림 네모의 변·모서리를 끌어 크기를 바꿨다(새 자리) */
  onRegionHighlightResize?: (highlightId: string, anchor: Anchor) => void
  onSelectionChange?: (selection: PdfExcerptSelection | null) => void
  onSendToCanvas?: (selection: PdfExcerptSelection) => void
  onCopyWithSource?: (selection: PdfExcerptSelection) => void
  onSearchDocuments?: (selection: PdfExcerptSelection) => void
  onTranslate?: (selection: PdfExcerptSelection) => Promise<PdfSelectionTranslation | null>
  onSendTranslationToCanvas?: (
    selection: PdfExcerptSelection,
    translation: PdfSelectionTranslation,
  ) => void
}

function anchorBounds(anchor: Anchor) {
  const first = anchor.rects[0]
  if (first === undefined) return null
  let left = first.x
  let top = first.y
  let right = first.x + first.w
  let bottom = first.y + first.h
  for (const rect of anchor.rects.slice(1)) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.w)
    bottom = Math.max(bottom, rect.y + rect.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function localPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

/**
 * 형광펜 한 개의 줄 상자들을 한 도형(path)으로 묶는다. 줄 상자가 위아래로 조금 겹쳐도 한 번만 칠해져
 * 겹친 띠가 진하게 남지 않는다(상자마다 따로 곱하기로 칠하면 겹친 곳이 두 번 물든다).
 */
/** 표·그림 네모는 대상의 테두리 선과 겹치지 않게 이만큼(화면 px) 바깥에 그린다 */
const REGION_OUTSET = 4
const REGION_RADIUS = 6

/** 표·그림 네모의 네 귀퉁이 꺾쇠(형광펜 색 굵은 선). 귀퉁이는 네모와 같은 둥글기 */
function regionCornersPath(x: number, y: number, w: number, h: number): string {
  const n = (value: number) => Math.round(value * 100) / 100
  const r = Math.min(REGION_RADIUS, w / 2, h / 2)
  const len = Math.max(r + 2, Math.min(18, w / 4, h / 4))
  return [
    `M${n(x)} ${n(y + len)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}H${n(x + len)}`,
    `M${n(x + w - len)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + len)}`,
    `M${n(x + w)} ${n(y + h - len)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + w - len)}`,
    `M${n(x + len)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + h - len)}`,
  ].join('')
}

function rectsPath(rects: readonly AnchorRect[], renderScale: number): string {
  const n = (value: number) => Math.round(value * 100) / 100
  return rects.map((rect) => {
    const x = rect.x * renderScale
    const y = rect.y * renderScale
    const w = rect.w * renderScale
    const h = rect.h * renderScale
    const r = Math.max(0, Math.min(2, w / 2, h / 2))
    return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`
      + `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`
      + `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`
      + `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
  }).join('')
}

/** 같은 자리를 가리키는가(새 메모로 칠해진 선택은 선택 색을 겹쳐 칠하지 않는다) */
function sameSpot(a: Anchor, b: Anchor): boolean {
  return a.page === b.page && a.charRange[0] === b.charRange[0] && a.charRange[1] === b.charRange[1] && a.quote === b.quote
}

function regionRect(from: Point, to: Point, renderScale: number) {
  const left = Math.min(from.x, to.x) / renderScale
  const top = Math.min(from.y, to.y) / renderScale
  return {
    x: left,
    y: top,
    w: Math.abs(to.x - from.x) / renderScale,
    h: Math.abs(to.y - from.y) / renderScale,
  }
}

const TIP_GAP = 12
const TIP_MARGIN = 6

/** 마우스 곁에 띄우되 스크롤 칸(없으면 창)의 보이는 영역 안에 늘 다 들어오게 옆·위아래로 뒤집고 눌러 담는다 */
function OtherNoteTip({ x, y, label, body, within }: { x: number; y: number; label: string; body: string; within: Element | null }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const pane = within?.closest('[data-pdf-pane]')?.getBoundingClientRect()
    const minX = Math.max(pane?.left ?? 0, 0) + TIP_MARGIN
    const minY = Math.max(pane?.top ?? 0, 0) + TIP_MARGIN
    const maxX = Math.min(pane?.right ?? window.innerWidth, window.innerWidth) - TIP_MARGIN
    const maxY = Math.min(pane?.bottom ?? window.innerHeight, window.innerHeight) - TIP_MARGIN
    const { width, height } = el.getBoundingClientRect()
    let left = x + TIP_GAP
    if (left + width > maxX) left = x - TIP_GAP - width
    let top = y + TIP_GAP + 4
    if (top + height > maxY) top = y - TIP_GAP - height
    setPos({
      left: Math.max(minX, Math.min(left, maxX - width)),
      top: Math.max(minY, Math.min(top, maxY - height)),
    })
  }, [x, y, label, body, within])
  return createPortal(
    <div ref={ref} className="selection-other-tip" role="tooltip" style={{ left: `${pos?.left ?? 0}px`, top: `${pos?.top ?? 0}px`, visibility: pos === null ? 'hidden' : 'visible' }}>
      <span className="selection-other-tip-label">{label}</span>
      {body === '' ? null : <span className="selection-other-tip-body">{body}</span>}
    </div>,
    document.body,
  )
}

export function SelectionLayer({
  docId,
  page,
  index,
  renderScale,
  width,
  height,
  sourceTitle,
  pageSize,
  mode = 'text',
  highlightColor = 'yellow',
  anchor,
  persistentHighlights: allPersistentHighlights = [],
  otherNote = null,
  passiveHighlights = [],
  searchHighlights = [],
  onAnchorCreated,
  onPersistentHighlightCreated,
  onPersistentHighlightRemoved,
  eraseHighlights = false,
  onPersistentHighlightActivate,
  onPersistentHighlightHover,
  onRegionHighlightResize,
  resetKey = 0,
  flashHighlightId = null,
  onSelectionChange,
  onSendToCanvas,
  onCopyWithSource,
  onSearchDocuments,
  onTranslate,
  onSendTranslationToCanvas,
}: SelectionLayerProps) {
  // 방금 만든 것·깜빡이는 것은 노트에 담기는 중일 수 있어 늘 보통으로 둔다
  const isOther = (id: string) => otherNote !== null && otherNote.labels.has(id) && !isFreshHighlight(id) && id !== flashHighlightId
  // 숨기기: 그리지도, 눌러지지도 않는다(그 자리에서 글을 고르고 새로 칠할 수 있게)
  const persistentHighlights = otherNote?.mode === 'hide' ? allPersistentHighlights.filter(({ id }) => !isOther(id)) : allPersistentHighlights
  const [otherTip, setOtherTip] = useState<{ x: number; y: number; cx: number; cy: number; label: string; body: string } | null>(null)
  // 노트를 바꾸거나 설정이 바뀌면 떠 있던 말풍선은 거둔다(마우스가 움직이지 않으면 거두는 계기가 없다)
  useEffect(() => { setOtherTip(null) }, [otherNote])
  const [gesture, setGesture] = useState<SelectionGesture | null>(null)
  const [draft, setDraft] = useState<PdfExcerptSelection | null>(null)
  const [draftRegion, setDraftRegion] = useState<ReturnType<typeof regionRect> | null>(null)
  const [committed, setCommitted] = useState<PdfExcerptSelection | null>(null)
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null)
  const selectionEpochRef = useRef(0)
  const [externalCleared, setExternalCleared] = useState(false)
  // 손 도구에서 마우스가 글자 위인가(커서: 글자 위는 I, 빈 곳은 손)
  const [hoverText, setHoverText] = useState(false)
  // 글 고르기는 텍스트 도구와 손 도구가 같다(형광펜 누르기·메모 열기 포함)
  const textLike = mode === 'text' || mode === 'hand' || mode === 'box'
  const suppressContextMenuRef = useRef(false)
  const interactionLayerRef = useRef<SVGSVGElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  // 끌지 않은 우클릭으로 연 문서 메뉴(화면 좌표)
  const [docMenu, setDocMenu] = useState<{ x: number; y: number; selection: PdfExcerptSelection | null } | null>(null)
  const rightPressSelectionRef = useRef<PdfExcerptSelection | null>(null)
  // 우클릭 메뉴를 연 글 선택. 메뉴가 초점을 가져가 빈 새 메모가 접히며 선택이 풀려도 화면에는 계속 칠해 둔다
  // (다른 곳을 누르거나 새로 고를 때까지)
  const [held, setHeld] = useState<PdfExcerptSelection | null>(null)
  /** 사용자가 마지막으로 고른 앵커(영역이었는가) */
  const userAnchorRef = useRef<{ readonly anchor: Anchor; readonly region: boolean } | null>(null)

  useEffect(() => () => dragPreviewCleanupRef.current?.(), [])
  useEffect(() => () => { selectionEpochRef.current += 1 }, [docId, page])

  useEffect(() => {
    setCommitted(null)
    setExternalCleared(false)
  }, [anchor])

  const lastResetKeyRef = useRef(resetKey)
  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) return
    lastResetKeyRef.current = resetKey
    // 이미 고른 것만 내린다. 지금 막 시작한 새 끌기(gesture)는 건드리지 않는다
    setCommitted(null)
    setExternalCleared(true)
  }, [resetKey])

  const external = anchor === undefined || externalCleared
    ? null
    : createTextExcerptSelection(anchor, index, pageSize)
  const shown = draft ?? committed ?? external
  // 글 고르기 메뉴(복사·번역 …)는 사용자가 글을 고른 때만. 검색 결과로 칠해 준 자리(external)와
  // 영역 캡처(영역 메모 초안이 바로 열린다)에는 띄우지 않는다.
  // 사용자가 고른 것은 바깥이 같은 앵커를 다시 내려 주므로(external), 마지막으로 고른 앵커와 같은지로 가린다
  const lastUser = userAnchorRef.current
  const externalIsUser = external !== null && lastUser !== null && anchor === lastUser.anchor
  const userSelection = draft ?? committed ?? (externalIsUser ? external : null)
  const userRegion = draft !== null ? draft.mode === 'region' : committed !== null ? committed.mode === 'region' : lastUser?.region === true
  const showActions = userSelection !== null && !userRegion

  const holding = held !== null
  useEffect(() => {
    if (shown === null && !holding) return
    const clearSelectionOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target === null
        || interactionLayerRef.current?.contains(target)
        || actionsRef.current?.contains(target)
        || (target instanceof Element && target.closest('.app-context-menu') !== null)) return
      setHeld(null)
      selectionEpochRef.current += 1
      setGesture(null)
      setDraft(null)
      setDraftRegion(null)
      setCommitted(null)
      setExternalCleared(true)
      window.getSelection()?.removeAllRanges()
      onSelectionChange?.(null)
    }
    document.addEventListener('pointerdown', clearSelectionOutside)
    return () => document.removeEventListener('pointerdown', clearSelectionOutside)
  }, [onSelectionChange, shown, holding])

  // Ctrl+C: 고른 PDF 글을 복사한다. 글을 고르면 메모 바의 새 메모 칸이 포커스를 가져가
  // 브라우저 기본 복사로는 아무것도 복사되지 않았다. 다른 칸에서 따로 고른 글이 있으면 그쪽을 둔다
  const shownQuote = (shown ?? held)?.anchor.quote ?? ''
  useEffect(() => {
    if (shownQuote.trim() === '') return
    const copyShown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'c') return
      const active = document.activeElement
      if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        && active.selectionStart !== active.selectionEnd) return
      const own = window.getSelection()
      if (own !== null && !own.isCollapsed && own.toString().trim() !== '') return
      event.preventDefault()
      void navigator.clipboard?.writeText(shownQuote)
      announceAction(t('복사했습니다'))
    }
    window.addEventListener('keydown', copyShown, true)
    return () => window.removeEventListener('keydown', copyShown, true)
  }, [shownQuote])

  const selectionAt = (active: SelectionGesture, to: Point): PdfExcerptSelection | null => {
    if (active.mode === 'region') {
      if (Math.abs(to.x - active.from.x) < 2 || Math.abs(to.y - active.from.y) < 2) return null
      return createRegionExcerptSelection({
        docId,
        page,
        rect: regionRect(active.from, to, renderScale),
        index,
        pageSize,
      })
    }
    const range = selectionRange(index, renderScale, active.from, to)
    if (range === null) return null
    return createTextExcerptSelection(
      buildAnchor(docId, page, index, range[0], range[1]),
      index,
      pageSize,
    )
  }

  /** 이 페이지 위의 점(화면 px)을 덮는 형광펜. 겹치면 나중에 칠한 것이 위다 */
  const persistentHighlightAt = (point: { x: number; y: number }) => {
    const pdfPoint = { x: point.x / renderScale, y: point.y / renderScale }
    return [...persistentHighlights].reverse().find(({ anchor: persistentAnchor }) =>
      persistentAnchor.rects.some((rect) =>
        pdfPoint.x >= rect.x
        && pdfPoint.x <= rect.x + rect.w
        && pdfPoint.y >= rect.y
        && pdfPoint.y <= rect.y + rect.h,
      ),
    )
  }

  // 형광펜 위에서 누르면 새로 고르지 않고(형광펜 안에 또 형광펜 금지) 떼면 그 메모를 연다
  const pendingHighlightRef = useRef<{ id: string; x: number; y: number } | null>(null)
  // 손 도구로 빈 곳을 누른 자리(떼었을 때 움직이지 않았으면 그냥 누르기)
  const handClickRef = useRef<{ x: number; y: number } | null>(null)
  const [hoverHighlight, setHoverHighlight] = useState(false)
  const hoveredIdRef = useRef<string | null>(null)

  // ---------- 표·그림 네모 크기 바꾸기(텍스트·영역 캡처 도구) ----------
  const resizeEnabled = onRegionHighlightResize !== undefined && (mode === 'text' || mode === 'lasso') && !eraseHighlights
  const [resize, setResize] = useState<RegionResize | null>(null)
  const [resizeRect, setResizeRect] = useState<AnchorRect | null>(null)
  const [hoverEdge, setHoverEdge] = useState<{ id: string; edges: RegionEdges } | null>(null)
  const [hoverRegionId, setHoverRegionId] = useState<string | null>(null)
  /** 이 점(화면 px)이 걸친 표·그림 네모의 변. 위에 그린 것이 먼저 */
  const regionEdgeAt = (point: Point): { id: string; rect: AnchorRect; edges: RegionEdges } | null => {
    for (const highlight of [...persistentHighlights].reverse()) {
      if (highlight.kind !== 'region') continue
      const rect = highlight.anchor.rects[0]
      if (rect === undefined) continue
      const left = rect.x * renderScale
      const top = rect.y * renderScale
      const right = (rect.x + rect.w) * renderScale
      const bottom = (rect.y + rect.h) * renderScale
      const g = RESIZE_GRIP_PX
      if (point.x < left - g || point.x > right + g || point.y < top - g || point.y > bottom + g) continue
      const edges = {
        left: Math.abs(point.x - left) <= g,
        right: Math.abs(point.x - right) <= g,
        top: Math.abs(point.y - top) <= g,
        bottom: Math.abs(point.y - bottom) <= g,
      }
      if (edges.left || edges.right || edges.top || edges.bottom) return { id: highlight.id, rect, edges }
    }
    return null
  }
  const regionInside = (point: Point): string | null => {
    for (const highlight of [...persistentHighlights].reverse()) {
      if (highlight.kind !== 'region') continue
      const rect = highlight.anchor.rects[0]
      if (rect === undefined) continue
      const g = RESIZE_GRIP_PX
      if (point.x >= rect.x * renderScale - g && point.x <= (rect.x + rect.w) * renderScale + g
        && point.y >= rect.y * renderScale - g && point.y <= (rect.y + rect.h) * renderScale + g) return highlight.id
    }
    return null
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    // 오른쪽 단추는 앱의 마우스 제스처(위·아래로 끝까지, ㄴ 탭 닫기 …)가 쓴다
    if (event.altKey || event.button !== 0) return
    setHeld(null)
    const point = localPoint(event)
    if (resizeEnabled && !event.ctrlKey) {
      const edge = regionEdgeAt(point)
      if (edge !== null) {
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
        setResize({ id: edge.id, pointerId: event.pointerId, edges: edge.edges, start: edge.rect, from: point })
        setResizeRect(edge.rect)
        return
      }
    }
    // 손 도구: 글자가 없는 곳은 고르지 않고 PdfPane 이 화면을 잡아 옮긴다(기본 동작을 막지 않고 넘긴다)
    if (mode === 'hand' && !event.ctrlKey && !textNearPoint(index, renderScale, point)
      && (onPersistentHighlightActivate === undefined || persistentHighlightAt(point) === undefined)) {
      handClickRef.current = { x: event.clientX, y: event.clientY }
      return
    }
    handClickRef.current = null
    selectionEpochRef.current += 1
    // 형광펜 위에서 눌러도 글자 고르기를 시작한다. 끌지 않고 떼면(아래 pointerup) 그 형광펜의 메모를 연다.
    // 예전에는 형광펜 위에서는 고르기가 시작되지 않아, 메모로 칠한 문장은 다시 고를 수 없었다
    pendingHighlightRef.current = null
    if (eraseHighlights && mode === 'highlight' && event.button === 0) {
      event.preventDefault()
      const hit = persistentHighlightAt(point)
      if (hit !== undefined) {
        onPersistentHighlightRemoved?.(hit.id)
        announceAction(t('형광펜 표시를 지웠습니다'))
      }
      return
    }
    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setGesture({
      pointerId: event.pointerId,
      button: event.button,
      // 표·그림(영역): 영역 선택 도구, Ctrl+끌기, 글자가 없는 쪽
      mode: mode === 'lasso' || event.ctrlKey || index.chars.length === 0 ? 'region' : 'text',
      from: point,
    })
    setDraft(null)
    setDraftRegion(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    // 형광펜 위에서 누른 채 끌면 열지 않는다(고르기도 하지 않는다)
    if (resize !== null) {
      if (event.pointerId !== resize.pointerId) return
      const to = localPoint(event)
      setResizeRect(resizedRegion(resize.start, resize.edges, (to.x - resize.from.x) / renderScale, (to.y - resize.from.y) / renderScale, pageSize))
      return
    }
    const pending = pendingHighlightRef.current
    if (pending !== null && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 4) pendingHighlightRef.current = null
    if (gesture === null) {
      // 형광펜 위면 누를 수 있다는 손가락 모양
      const point = localPoint(event)
      const hit = textLike && !eraseHighlights && onPersistentHighlightActivate !== undefined ? persistentHighlightAt(point) : undefined
      const over = hit !== undefined
      if (over !== hoverHighlight) setHoverHighlight(over)
      // 메뉴 항목을 막 고른 자리면 호버 보고는 미룬다(hoveredIdRef 를 안 바꾸니 포인터가 진짜 움직이면 다음 move 에서 보고된다)
      if (!menuGuardActive() && (hit?.id ?? null) !== hoveredIdRef.current) {
        hoveredIdRef.current = hit?.id ?? null
        onPersistentHighlightHover?.(hoveredIdRef.current)
      }
      // 노트에 없는 형광펜이면 어느 노트의 것인지 작은 말풍선으로
      const tipLabel = hit !== undefined && isOther(hit.id) ? otherNote?.labels.get(hit.id) : undefined
      const tipBody = hit !== undefined && tipLabel !== undefined ? otherNote?.bodies?.get(hit.id) ?? '' : ''
      if (tipLabel === undefined) {
        if (otherTip !== null) setOtherTip(null)
      } else if (otherTip === null || otherTip.label !== tipLabel || otherTip.body !== tipBody || Math.abs(otherTip.x - point.x) > 6 || Math.abs(otherTip.y - point.y) > 6) {
        setOtherTip({ x: point.x, y: point.y, cx: event.clientX, cy: event.clientY, label: tipLabel, body: tipBody })
      }
      if (resizeEnabled) {
        const edge = regionEdgeAt(point)
        const next = edge === null ? null : { id: edge.id, edges: edge.edges }
        if (next?.id !== hoverEdge?.id || (next !== null && hoverEdge !== null && edgeCursor(next.edges) !== edgeCursor(hoverEdge.edges))) setHoverEdge(next)
        const inside = regionInside(point)
        if (inside !== hoverRegionId) setHoverRegionId(inside)
      }
      if (mode === 'hand') {
        const onText = textNearPoint(index, renderScale, point)
        if (onText !== hoverText) setHoverText(onText)
      }
      return
    }
    if (gesture.pointerId !== event.pointerId) return
    if (gesture.mode === 'region') {
      const to = localPoint(event)
      const next = Math.abs(to.x - gesture.from.x) < 2 || Math.abs(to.y - gesture.from.y) < 2
        ? null
        : regionRect(gesture.from, to, renderScale)
      if (gesture.button === 2 && next !== null) {
        suppressContextMenuRef.current = true
        event.preventDefault()
      }
      setDraftRegion(next)
      return
    }
    const next = selectionAt(gesture, localPoint(event))
    if (gesture.button === 2 && next !== null) {
      suppressContextMenuRef.current = true
      event.preventDefault()
    }
    setDraft(next)
  }

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (resize !== null) {
      if (event.pointerId !== resize.pointerId) return
      const finalRect = resizeRect ?? resize.start
      setResize(null)
      setResizeRect(null)
      if (typeof event.currentTarget.releasePointerCapture === 'function') event.currentTarget.releasePointerCapture(event.pointerId)
      const moved = Math.abs(finalRect.x - resize.start.x) + Math.abs(finalRect.y - resize.start.y)
        + Math.abs(finalRect.w - resize.start.w) + Math.abs(finalRect.h - resize.start.h)
      if (moved < 0.5) return
      const region = createRegionExcerptSelection({ docId, page, rect: finalRect, index, pageSize })
      onRegionHighlightResize?.(resize.id, region.anchor)
      return
    }
    // 손 도구로 빈 곳을 누르기만 했으면(옮기지 않고) 고른 것을 푼다(텍스트 도구의 빈 곳 누르기와 같다)
    const handClick = handClickRef.current
    handClickRef.current = null
    if (handClick !== null && gesture === null) {
      if (event.button === 0 && Math.hypot(event.clientX - handClick.x, event.clientY - handClick.y) < 4 && shown !== null) {
        setCommitted(null)
        setExternalCleared(true)
        onSelectionChange?.(null)
      }
      return
    }
    const pendingHighlight = pendingHighlightRef.current
    pendingHighlightRef.current = null
    if (gesture === null && pendingHighlight !== null && event.button === 0) {
      onPersistentHighlightActivate?.(pendingHighlight.id, { x: event.clientX, y: event.clientY })
      return
    }
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    const completed = selectionAt(gesture, localPoint(event))
    setGesture(null)
    setDraft(null)
    setDraftRegion(null)
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (completed === null) {
      if (gesture.button === 2) return
      // 끌지 않은 클릭. 형광펜 위였다면 그 형광펜의 메모 창을 연다.
      // 글자 층이 없는 쪽(스캔)은 글 모드여도 영역으로 고르지만, 클릭은 똑같이 메모를 연다(Ctrl+누르기는 빼고)
      if (textLike && (gesture.mode === 'text' || (index.chars.length === 0 && !event.ctrlKey)) && onPersistentHighlightActivate !== undefined) {
        const hit = persistentHighlightAt(localPoint(event))
        if (hit !== undefined) {
          onPersistentHighlightActivate(hit.id, { x: event.clientX, y: event.clientY })
          return
        }
      }
      setCommitted(null)
      setExternalCleared(true)
      onSelectionChange?.(null)
      return
    }
    const hasGlyphs = completed.glyphs.some((glyph) => glyph.c.trim().length > 0 && glyph.h > 0)
    const image = event.currentTarget.closest('.pdf-page-slot')?.querySelector<HTMLImageElement>('.pdf-page') ?? null
    const visualTextHeight = hasGlyphs ? null : estimateSelectionTextHeight(completed, image)
    const resolved = visualTextHeight === null ? completed : { ...completed, visualTextHeight }
    setExternalCleared(false)
    setCommitted(resolved)
    userAnchorRef.current = { anchor: resolved.anchor, region: resolved.mode === 'region' }
    onSelectionChange?.(resolved)
    if (!hasGlyphs) {
      const epoch = selectionEpochRef.current
      // 글자 층이 없는 곳(스캔): 글자 높이를 재고, 영역이면 OCR 로 글자를 읽어 원문에 넣는다(설정에서 끌 수 있다)
      let latest = resolved
      if (image !== null) void detectSelectionTextHeight(resolved, image).then((height) => {
        if (height === null || selectionEpochRef.current !== epoch) return
        latest = { ...latest, visualTextHeight: height }
        setCommitted(latest)
        onSelectionChange?.(latest)
      })
      if (resolved.mode === 'region' && resolved.anchor.quote.trim() === '' && getAppPrefs().ocr) {
        void recognizeSelectionText(resolved, image).then((text) => {
          if (text === null || selectionEpochRef.current !== epoch) return
          latest = { ...latest, anchor: { ...latest.anchor, quote: text.replace(/\s+/gu, ' ').trim().slice(0, 4000) } }
          userAnchorRef.current = { anchor: latest.anchor, region: true }
          setCommitted(latest)
          onSelectionChange?.(latest)
          announceAction(t('영역의 글자를 읽었습니다(OCR)'))
        }).catch(() => undefined)
      }
    }
    if (mode === 'highlight' && resolved.mode === 'text') {
      onPersistentHighlightCreated?.(createPersistentPdfHighlight(resolved.anchor, highlightColor, {
        createdAt: new Date().toISOString(),
        source: 'iwae',
      }))
      announceAction(t('PDF에 형광펜을 표시했습니다'))
    } else {
      onAnchorCreated?.(resolved.anchor)
    }
  }

  const handlePointerCancel = () => {
    setResize(null)
    setResizeRect(null)
    setGesture(null)
    setDraft(null)
    setDraftRegion(null)
  }


  const bounds = shown?.crop
  const selectionIsRegion = draftRegion !== null || shown?.mode === 'region'
  // 손을 떼면 고른 자리가 새 메모의 형광펜으로 칠해진다. 그 위에 선택 색까지 겹치면 두 색이 섞여 탁해지므로
  // 끄는 동안(draft)만 선택 색을 보이고, 같은 자리의 형광펜이 생기면 선택 색은 걷는다.
  const visible = shown ?? held
  const coveredByHighlight = draft === null && visible !== null && visible.mode !== 'region'
    && persistentHighlights.some((highlight) => highlight.kind !== 'region' && sameSpot(highlight.anchor, visible.anchor))
  const highlightRects = draftRegion !== null ? [draftRegion] : visible === null || coveredByHighlight
    ? []
    : visible.mode === 'region'
      ? [visible.crop]
      : coalesceHighlightRects(visible.anchor.rects)

  return (
    <>
      <svg
        className="selection-mark-layer"
        aria-hidden="true"
        data-page={page}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {searchHighlights.map(({ id, rects, active }) => (
          <path
            key={id}
            className={`selection-search-highlight${active ? ' selection-search-highlight-active' : ''}`}
            data-search-highlight={id}
            d={rectsPath(coalesceHighlightRects(rects), renderScale)}
          />
        ))}
        {passiveHighlights.map(({ blockId, anchor: passiveAnchor }) => (
          <path
            key={blockId}
            className="source-highlight selection-source-highlight"
            data-source-highlight={blockId}
            d={rectsPath(coalesceHighlightRects(passiveAnchor.rects), renderScale)}
          />
        ))}
        {persistentHighlights.map(({ id, anchor: rawAnchor, color, kind }) => {
          const persistentAnchor = resize?.id === id && resizeRect !== null ? { ...rawAnchor, rects: [resizeRect] } : rawAnchor
          const className = `selection-persistent-highlight${isOther(id) ? ' selection-highlight-other' : ''}${kind === 'region' ? ' selection-persistent-region' : ''}${id === flashHighlightId ? ' selection-highlight-flash' : ''}${isFreshHighlight(id) ? ' selection-highlight-new' : ''}`
          return kind === 'region'
            ? coalesceHighlightRects(persistentAnchor.rects).map((rect, rectIndex) => {
                // 대상 테두리 바깥에 옅은 바탕 + 얇은 선, 네 귀퉁이에만 형광펜 색 꺾쇠(표 전체가 노랗게 물들지 않게)
                const x = rect.x * renderScale - REGION_OUTSET
                const y = rect.y * renderScale - REGION_OUTSET
                const w = rect.w * renderScale + REGION_OUTSET * 2
                const h = rect.h * renderScale + REGION_OUTSET * 2
                return (
                  <Fragment key={`${id}:${rectIndex}`}>
                    <rect className={className} data-persistent-highlight={id} data-hl={color} x={x} y={y} width={w} height={h} />
                    <path className={`selection-persistent-highlight selection-region-corners${isOther(id) ? ' selection-highlight-other' : ''}`} data-hl={color} d={regionCornersPath(x, y, w, h)} />
                  </Fragment>
                )
              })
            : (
                <path
                  key={id}
                  className={className}
                  data-persistent-highlight={id}
                  data-hl={color}
                  d={rectsPath(coalesceHighlightRects(persistentAnchor.rects), renderScale)}
                />
              )
        })}
        {(() => {
          // 크기 바꾸는 중이거나 마우스를 올린 표·그림 네모: 테두리와 손잡이
          const id = resize?.id ?? (resizeEnabled ? hoverEdge?.id ?? hoverRegionId : null)
          if (id === null || id === undefined) return null
          const rect = resize !== null && resizeRect !== null ? resizeRect : persistentHighlights.find((item) => item.id === id)?.anchor.rects[0]
          if (rect === undefined) return null
          const x = rect.x * renderScale - REGION_OUTSET
          const y = rect.y * renderScale - REGION_OUTSET
          const w = rect.w * renderScale + REGION_OUTSET * 2
          const h = rect.h * renderScale + REGION_OUTSET * 2
          const handles: readonly (readonly [number, number])[] = [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]
          return (
            <g className="selection-region-resize">
              <rect className="selection-region-resize-frame" x={x} y={y} width={w} height={h} />
              {handles.map(([cx, cy], handle) => (
                <rect key={handle} className="selection-region-resize-handle" x={cx - 4} y={cy - 4} width={8} height={8} />
              ))}
            </g>
          )
        })()}
        {selectionIsRegion
          ? highlightRects.map((rect, rectIndex) => (
              <rect
                key={`selection:${rect.x}:${rect.y}:${rectIndex}`}
                className="selection-highlight selection-region"
                x={rect.x * renderScale}
                y={rect.y * renderScale}
                width={rect.w * renderScale}
                height={rect.h * renderScale}
              />
            ))
          : highlightRects.length > 0
            ? <path className="selection-highlight" d={rectsPath(highlightRects, renderScale)} />
            : null}
      </svg>
      <svg
        ref={interactionLayerRef}
        className={`selection-layer selection-interaction-layer selection-mode-${mode}${gesture?.mode === 'region' ? ' selection-gesture-region' : ''}${eraseHighlights ? ' selection-highlight-eraser' : ''}`}
        data-testid="selection-layer"
        data-page={page}
        data-hl={highlightColor}
        style={{ cursor: resize !== null ? edgeCursor(resize.edges) : resizeEnabled && gesture === null && hoverEdge !== null ? edgeCursor(hoverEdge.edges) : gesture === null && hoverHighlight ? 'pointer' : gesture?.mode === 'region' || mode === 'lasso' || eraseHighlights ? 'crosshair' : mode === 'hand' ? (gesture !== null || hoverText ? 'text' : 'grab') : index.chars.length === 0 ? 'crosshair' : 'text' }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onContextMenu={(event) => {
          event.preventDefault()
          if (suppressContextMenuRef.current) {
            suppressContextMenuRef.current = false
            return
          }
          // 끌지 않은 우클릭: 문서 메뉴(고른 글이 있으면 복사 등도)
          const picked = (showActions ? userSelection : null) ?? rightPressSelectionRef.current
          if (picked !== null) setHeld(picked)
          setDocMenu({ x: event.clientX, y: event.clientY, selection: picked })
        }}
        // 오른쪽 단추로 눌러도 초점을 옮기지 않는다: 새 메모 칸이 초점을 잃으면 빈 메모와 함께 고른 글이 사라져, 우클릭 메뉴에 복사가 안 나왔다
        onMouseDown={(event) => { if (event.button === 2) event.preventDefault() }}
        onPointerDownCapture={(event) => {
          if (event.button !== 2) return
          event.preventDefault()
          // 누른 순간의 고른 글(메뉴가 뜰 때는 이미 사라졌을 수 있다)
          rightPressSelectionRef.current = showActions ? userSelection : null
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          if (resize === null) {
            setHoverEdge(null)
            setHoverRegionId(null)
          }
          setHoverHighlight(false)
          setHoverText(false)
          setOtherTip(null)
          if (hoveredIdRef.current !== null) {
            hoveredIdRef.current = null
            onPersistentHighlightHover?.(null)
          }
        }}
      />
      {otherTip === null ? null : <OtherNoteTip x={otherTip.cx} y={otherTip.cy} label={otherTip.label} body={otherTip.body} within={interactionLayerRef.current} />}
      {passiveHighlights.map(({ blockId, anchor: passiveAnchor }) => {
        const bounds = anchorBounds(passiveAnchor)
        return bounds === null ? null : (
          <div
            key={blockId}
            className="pdf-source-target"
            data-pdf-source-target={blockId}
            style={{
              left: `${bounds.x * renderScale}px`,
              top: `${bounds.y * renderScale}px`,
              width: `${Math.max(bounds.w * renderScale, 8)}px`,
              height: `${Math.max(bounds.h * renderScale, 8)}px`,
            }}
          />
        )
      })}
      {docMenu === null ? null : (
        <ContextMenu
          x={docMenu.x}
          y={docMenu.y}
          label={t('문서 메뉴')}
          onClose={() => setDocMenu(null)}
          entries={(() => {
            const picked = docMenu.selection
            // 이 쪽에 글자가 있나: 없으면(스캔 쪽) 「OCR (스캔 글자 인식)」를 보인다
            const pdf = { docId, hasText: index.chars.some((char) => char.c.trim() !== '' && char.w > 0) }
            return documentContextEntries(picked === null ? { pdf } : {
              pdf,
              selectedText: picked.anchor.quote,
              ...(onCopyWithSource === undefined ? {} : { onCopyWithSource: () => onCopyWithSource(picked) }),
              ...(onSearchDocuments === undefined ? {} : { onSearchSelection: () => onSearchDocuments(picked) }),
            })
          })()}
        />
      )}
      {!showActions || shown === null || bounds === undefined ? null : (
        <>
          <div
            ref={actionsRef}
            className="selection-actions-anchor"
            style={{
              left: `${bounds.x * renderScale}px`,
              top: `${Math.max(bounds.y * renderScale - 38, 4)}px`,
            }}
          >
            <SelectionActions
              selection={shown}
              onCopy={(selection) => {
                if (selection.anchor.quote.length > 0) void navigator.clipboard?.writeText(selection.anchor.quote)
              }}
              onSendToCanvas={onSendToCanvas}
              onCopyWithSource={onCopyWithSource}
              onSearchDocuments={onSearchDocuments}
              onTranslate={onTranslate}
              onSendTranslationToCanvas={onSendTranslationToCanvas}
            />
          </div>
        </>
      )}
    </>
  )
}
