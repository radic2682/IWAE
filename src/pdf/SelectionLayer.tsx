import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import { detectSelectionTextHeight } from './ocrTextDetector'
import { SelectionActions, type PdfSelectionTranslation } from './SelectionActions'
import {
  createPersistentPdfHighlight,
  type PdfHighlightColor,
  type PersistentPdfHighlight,
} from './persistentHighlight'
import { t } from '../i18n'

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
  persistentHighlights = [],
  passiveHighlights = [],
  searchHighlights = [],
  onAnchorCreated,
  onPersistentHighlightCreated,
  onPersistentHighlightRemoved,
  eraseHighlights = false,
  onPersistentHighlightActivate,
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

  useEffect(() => {
    if (shown === null) return
    const clearSelectionOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target === null
        || interactionLayerRef.current?.contains(target)
        || actionsRef.current?.contains(target)) return
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
  }, [onSelectionChange, shown])

  // Ctrl+C: 고른 PDF 글을 복사한다. 글을 고르면 메모 바의 새 메모 칸이 포커스를 가져가
  // 브라우저 기본 복사로는 아무것도 복사되지 않았다. 다른 칸에서 따로 고른 글이 있으면 그쪽을 둔다
  const shownQuote = shown?.anchor.quote ?? ''
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
      const over = textLike && !eraseHighlights && onPersistentHighlightActivate !== undefined && persistentHighlightAt(point) !== undefined
      if (over !== hoverHighlight) setHoverHighlight(over)
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
      if (textLike && gesture.mode === 'text' && onPersistentHighlightActivate !== undefined) {
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
    if (!hasGlyphs && image !== null) {
      const epoch = selectionEpochRef.current
      void detectSelectionTextHeight(resolved, image).then((height) => {
        if (height === null || selectionEpochRef.current !== epoch) return
        const refined = { ...resolved, visualTextHeight: height }
        setCommitted(refined)
        onSelectionChange?.(refined)
      })
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
  const coveredByHighlight = draft === null && shown !== null && shown.mode !== 'region'
    && persistentHighlights.some((highlight) => highlight.kind !== 'region' && sameSpot(highlight.anchor, shown.anchor))
  const highlightRects = draftRegion !== null ? [draftRegion] : shown === null || coveredByHighlight
    ? []
    : shown.mode === 'region'
      ? [shown.crop]
      : coalesceHighlightRects(shown.anchor.rects)

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
          const className = `selection-persistent-highlight${kind === 'region' ? ' selection-persistent-region' : ''}${id === flashHighlightId ? ' selection-highlight-flash' : ''}`
          return kind === 'region'
            ? coalesceHighlightRects(persistentAnchor.rects).map((rect, rectIndex) => {
                // 대상 테두리 바깥에 옅은 바탕 + 얇은 선, 네 귀퉁이에만 형광펜 색 꺾쇠(표 전체가 노랗게 물들지 않게)
                const x = rect.x * renderScale - REGION_OUTSET
                const y = rect.y * renderScale - REGION_OUTSET
                const w = rect.w * renderScale + REGION_OUTSET * 2
                const h = rect.h * renderScale + REGION_OUTSET * 2
                return (
                  <Fragment key={`${id}:${rectIndex}`}>
                    <rect className={className} data-persistent-highlight={id} data-highlight-color={color} x={x} y={y} width={w} height={h} />
                    <path className="selection-persistent-highlight selection-region-corners" data-highlight-color={color} d={regionCornersPath(x, y, w, h)} />
                  </Fragment>
                )
              })
            : (
                <path
                  key={id}
                  className={className}
                  data-persistent-highlight={id}
                  data-highlight-color={color}
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
        data-highlight-color={highlightColor}
        style={{ cursor: resize !== null ? edgeCursor(resize.edges) : resizeEnabled && gesture === null && hoverEdge !== null ? edgeCursor(hoverEdge.edges) : gesture === null && hoverHighlight ? 'pointer' : gesture?.mode === 'region' || mode === 'lasso' || eraseHighlights ? 'crosshair' : mode === 'hand' ? (gesture !== null || hoverText ? 'text' : 'grab') : index.chars.length === 0 ? 'crosshair' : 'text' }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onContextMenu={(event) => {
          if (!suppressContextMenuRef.current) return
          event.preventDefault()
          suppressContextMenuRef.current = false
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
        }}
      />
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
