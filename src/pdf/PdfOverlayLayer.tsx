import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  createInk, createLine, createShape, createTextBox, dashArray, dashOf, dashPatch, inkPath, isMeaningfulLine, shapeBox, snapLineEnd, SHAPE_MIN_SIZE, TEXT_BOX_MIN_WIDTH,
  type OverlayColor, type OverlayPatch, type PdfInk, type PdfLine, type PdfOverlay, type PdfShape, type PdfTextBox,
} from '../core/pdfOverlays'
import type { BoxPageLayout } from './PdfBoxMemos'
import type { ToolStyle } from './overlayToolStore'
import { TextB, Trash, PaintBucket, BoundingBox, ArrowRight, ArrowsHorizontal } from '@phosphor-icons/react'
import '../ui/pdf-overlay.css'
import { t } from '../i18n'

export type OverlayTool = 'text' | 'pen' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse'

/** 새로 만들 것의 서식(도구마다 따로 기억한다: overlayToolStore) */
export type OverlayStyle = ToolStyle

/** 도형 도구인가 */
function shapeOfTool(tool: OverlayTool): PdfShape['shape'] | null {
  return tool === 'rect' ? 'rect' : tool === 'ellipse' ? 'ellipse' : null
}

interface PdfOverlayLayerProps {
  readonly overlays: readonly PdfOverlay[]
  readonly pageSizes: readonly (readonly [number, number])[]
  readonly layoutOf: (page: number) => BoxPageLayout | undefined
  readonly width: number
  readonly height: number
  /** 편집 모드: 새로 만들고 고르고 옮길 수 있다. 아니면 보기만(아래 글 선택을 막지 않는다) */
  readonly editMode: boolean
  readonly tool: OverlayTool
  readonly style: OverlayStyle
  readonly onAdd: (overlay: PdfOverlay) => void
  readonly onUpdate: (id: string, patch: OverlayPatch) => void
  readonly onRemove: (id: string) => void
  /** 지우개가 지나간 쪽 좌표: 형광펜·박스 메모도 지우게(바깥에서 맞춰 본다) */
  readonly onErasePoint?: (page: number, point: { readonly x: number; readonly y: number }) => void
  /** 고른 덮개(서식은 위 떠 있는 도구창에서 바꾼다). 주면 고르기를 밖에서 쥔다 */
  readonly selectedId?: string | null
  readonly onSelect?: (id: string | null) => void
}

type Point = { x: number; y: number }

const FILL: Record<NonNullable<PdfTextBox['fill']>, string> = { white: '#ffffff', yellow: '#fff3a8' }

/** 화살촉 두 변의 끝점(쪽 좌표). start 면 시작점 쪽 화살촉 */
function arrowHead(line: PdfLine, start = false): [Point, Point] {
  const tip = start ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 }
  const angle = start ? Math.atan2(line.y1 - line.y2, line.x1 - line.x2) : Math.atan2(line.y2 - line.y1, line.x2 - line.x1)
  const size = Math.max(6, line.width * 4)
  const spread = Math.PI / 7
  return [
    { x: tip.x - Math.cos(angle - spread) * size, y: tip.y - Math.sin(angle - spread) * size },
    { x: tip.x - Math.cos(angle + spread) * size, y: tip.y - Math.sin(angle + spread) * size },
  ]
}

/**
 * PDF 위에 직접 쓰는 글 상자와 선(덮개 층). 편집 모드에서 글 상자 도구는 누른 자리에, 선·화살표 도구는 끌어서 그린다(Shift 면 수평·수직·45°).
 * 만든 것은 눌러 고르고 끌어 옮기며, 고르면 위에 속성 막대(색·크기·굵기·화살표·지우기)가 뜬다. Delete 로도 지운다.
 */
export function PdfOverlayLayer({ overlays, pageSizes, layoutOf, width, height, editMode, tool, style, onAdd, onUpdate, onRemove, onErasePoint, selectedId: controlledSelected, onSelect }: PdfOverlayLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [ownSelected, setOwnSelected] = useState<string | null>(null)
  const selectedId = controlledSelected === undefined ? ownSelected : controlledSelected
  const setSelectedId = (id: string | null) => {
    if (controlledSelected === undefined) setOwnSelected(id)
    onSelect?.(id)
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  // 끄는 중(놓을 때 한 번만 저장): 옮기는 덮개의 임시 값, 새로 그리는 선
  const [moving, setMoving] = useState<{ id: string; patch: OverlayPatch } | null>(null)
  const [drawing, setDrawing] = useState<{ page: number; from: Point; to: Point; square?: boolean; textBox?: boolean } | null>(null)
  // 펜으로 그리는 중인 획(쪽 좌표 점들)
  const [inking, setInking] = useState<{ page: number; points: [number, number][] } | null>(null)
  // 새 글 상자: 글을 쓰기 전에는 저장하지 않는다(빈 상자가 쌓이지 않게)
  const [draft, setDraft] = useState<PdfTextBox | null>(null)
  // 쓰는 중인 글 상자를 끝내는 함수(빈 곳을 누르면 새 상자를 만들지 않고 이것만 부른다)
  const commitEditingRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!editMode) {
      commitEditingRef.current?.()
      setSelectedId(null)
      setEditingId(null)
    }
  }, [editMode])

  // Delete·Backspace 로 고른 것을 지운다(글을 쓰는 중에는 글자를 지우는 것이므로 제외)
  useEffect(() => {
    if (!editMode || selectedId === null || editingId !== null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/iu.test(target.tagName))) return
      event.preventDefault()
      onRemove(selectedId)
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, editingId, onRemove, selectedId])

  /** 화면 점 → (쪽, 쪽 좌표). 쪽 밖이면 null */
  const pageAt = (clientX: number, clientY: number): { page: number; point: Point; scale: number } | null => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) return null
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (let page = 0; page < pageSizes.length; page++) {
      const layout = layoutOf(page)
      const size = pageSizes[page]
      if (layout === undefined || size === undefined || size[0] <= 0) continue
      const scale = layout.width / size[0]
      if (x >= layout.left && x <= layout.left + layout.width && y >= layout.top && y <= layout.top + size[1] * scale) {
        return { page, point: { x: (x - layout.left) / scale, y: (y - layout.top) / scale }, scale }
      }
    }
    return null
  }

  const clampPoint = (point: Point, page: number): Point => {
    const size = pageSizes[page]
    return size === undefined ? point : { x: Math.min(Math.max(point.x, 0), size[0]), y: Math.min(Math.max(point.y, 0), size[1]) }
  }

  // 지우개: 누른 채 지나가는 덮개(펜 획·선·글 상자)를 지운다
  const eraseAt = (clientX: number, clientY: number, erased: Set<string>) => {
    if (onErasePoint !== undefined) {
      const hit = pageAt(clientX, clientY)
      if (hit !== null) onErasePoint(hit.page, hit.point)
    }
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      if (!(element instanceof Element) || rootRef.current?.contains(element) !== true) continue
      const id = element.closest('[data-overlay-id]')?.getAttribute('data-overlay-id')
      if (id != null && !erased.has(id)) {
        erased.add(id)
        onRemove(id)
        if (selectedId === id) setSelectedId(null)
      }
    }
  }
  const handleEraserDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode || tool !== 'eraser' || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const erased = new Set<string>()
    eraseAt(event.clientX, event.clientY, erased)
    const onMove = (moveEvent: PointerEvent) => eraseAt(moveEvent.clientX, moveEvent.clientY, erased)
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  // 빈 곳을 누르면: 글 상자는 그 자리에 만들고, 선은 끌어서 그린다. 만든 것이 없는 자리면 고른 것을 푼다
  const handleSurfaceDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode || event.button !== 0 || event.target !== event.currentTarget) return
    // 쓰는 중이거나 고른 것이 있으면, 빈 곳 누르기는 그것을 끝내기·풀기만 한다(바로 새 글 상자를 만들지 않는다)
    if (editingId !== null) {
      event.preventDefault()
      commitEditingRef.current?.()
      return
    }
    const hadSelection = selectedId !== null
    const hit = pageAt(event.clientX, event.clientY)
    setSelectedId(null)
    if (hit === null) return
    event.preventDefault()
    if (tool === 'text') {
      if (hadSelection) return
      // 누르면 기본 너비로 바로, 끌면 그 너비로 만든다
      const page = hit.page
      const from = hit.point
      const target = event.currentTarget
      target.setPointerCapture?.(event.pointerId)
      const textInit = { color: style.color, size: style.textSize, ...(style.bold ? { bold: true } : {}), ...(style.textFill === 'none' ? {} : { fill: style.textFill }), ...(style.border ? { border: true } : {}) }
      setDrawing({ page, from, to: from, textBox: true })
      const onTextMove = (moveEvent: PointerEvent) => {
        const at = pageAt(moveEvent.clientX, moveEvent.clientY)
        setDrawing({ page, from, to: at === null || at.page !== page ? from : clampPoint(at.point, page), textBox: true })
      }
      const finishText = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onTextMove)
        window.removeEventListener('pointerup', finishText)
        window.removeEventListener('pointercancel', finishText)
        setDrawing(null)
        if (upEvent.type === 'pointercancel') return
        const at = pageAt(upEvent.clientX, upEvent.clientY)
        const to = at === null || at.page !== page ? from : clampPoint(at.point, page)
        const dragged = Math.abs(to.x - from.x) >= TEXT_BOX_MIN_WIDTH / 2
        const box = createTextBox(page, Math.min(from.x, to.x), dragged ? Math.min(from.y, to.y) : from.y, { ...textInit, ...(dragged ? { w: Math.max(Math.abs(to.x - from.x), TEXT_BOX_MIN_WIDTH) } : {}) })
        setDraft(box)
        setSelectedId(box.id)
        setEditingId(box.id)
      }
      window.addEventListener('pointermove', onTextMove)
      window.addEventListener('pointerup', finishText)
      window.addEventListener('pointercancel', finishText)
      return
    }
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    if (tool === 'pen') {
      const page = hit.page
      const points: [number, number][] = [[hit.point.x, hit.point.y]]
      setInking({ page, points: [...points] })
      const onInkMove = (moveEvent: PointerEvent) => {
        const rect = rootRef.current?.getBoundingClientRect()
        const layout = layoutOf(page)
        const size = pageSizes[page]
        if (rect === undefined || layout === undefined || size === undefined || size[0] <= 0) return
        const scale = layout.width / size[0]
        // 쪽 밖으로 나가도 쪽 가장자리에 붙여 이어 그린다
        const point = clampPoint({ x: (moveEvent.clientX - rect.left - layout.left) / scale, y: (moveEvent.clientY - rect.top - layout.top) / scale }, page)
        points.push([point.x, point.y])
        setInking({ page, points: [...points] })
      }
      const finishInk = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onInkMove)
        window.removeEventListener('pointerup', finishInk)
        window.removeEventListener('pointercancel', finishInk)
        setInking(null)
        if (upEvent.type === 'pointercancel') return
        // 한 번 콕 누른 것은 점으로 남긴다(획이 너무 짧아도)
        const ink = createInk(page, points, { color: style.color, width: style.lineWidth })
        onAdd(ink)
      }
      window.addEventListener('pointermove', onInkMove)
      window.addEventListener('pointerup', finishInk)
      window.addEventListener('pointercancel', finishInk)
      return
    }
    const from = hit.point
    const page = hit.page
    const shape = shapeOfTool(tool)
    setDrawing({ page, from, to: from })
    // 선: Shift 면 수평·수직·45°. 도형: Shift 면 정사각형·원
    const endOf = (raw: Point, shift: boolean) => (shape === null && shift ? snapLineEnd(from, raw) : raw)
    const onMove = (moveEvent: PointerEvent) => {
      const at = pageAt(moveEvent.clientX, moveEvent.clientY)
      const raw = at === null ? from : clampPoint(at.page === page ? at.point : from, page)
      setDrawing({ page, from, to: endOf(raw, moveEvent.shiftKey), square: shape !== null && moveEvent.shiftKey })
    }
    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const at = pageAt(upEvent.clientX, upEvent.clientY)
      const raw = at === null || at.page !== page ? from : clampPoint(at.point, page)
      const to = endOf(raw, upEvent.shiftKey)
      setDrawing(null)
      if (upEvent.type === 'pointercancel') return
      if (shape !== null) {
        const box = shapeBox(from, to, upEvent.shiftKey)
        if (box.w < SHAPE_MIN_SIZE || box.h < SHAPE_MIN_SIZE) return
        const made = { ...createShape(page, shape, from, to, { color: style.color, width: style.lineWidth, fill: style.fill, ...dashPatch(style.dash) }), ...box }
        onAdd(made)
        setSelectedId(made.id)
        return
      }
      if (!isMeaningfulLine(from, to)) return
      const line = createLine(page, from, to, { color: style.color, width: style.lineWidth, arrow: style.arrowEnd, arrowStart: style.arrowStart, ...dashPatch(style.dash) })
      onAdd(line)
      setSelectedId(line.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  /** 덮개를 끌어 옮긴다(글 상자는 가장자리·머리, 선은 어디든). dx, dy 를 쪽 좌표로 바꿔 임시 값으로 보이다가 놓을 때 저장 */
  const startMove = (event: React.PointerEvent<HTMLElement>, overlay: PdfOverlay, scale: number, mode: 'move' | 'resize' | 'resize-left' | 'end1' | 'end2' | 'nw' | 'ne' | 'sw' | 'se' = 'move') => {
    if (!editMode || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (editingId !== null && editingId !== overlay.id) commitEditingRef.current?.()
    setSelectedId(overlay.id)
    const start = { x: event.clientX, y: event.clientY }
    const pageSize = pageSizes[overlay.page]
    const patchFor = (clientX: number, clientY: number, shift: boolean): OverlayPatch => {
      const dx = (clientX - start.x) / scale
      const dy = (clientY - start.y) / scale
      if (overlay.kind === 'text') {
        if (mode === 'resize') return { w: Math.max(overlay.w + dx, TEXT_BOX_MIN_WIDTH) }
        if (mode === 'resize-left') {
          const w = Math.max(overlay.w - dx, TEXT_BOX_MIN_WIDTH)
          return { x: overlay.x + overlay.w - w, w }
        }
        return pageSize === undefined ? { x: overlay.x + dx, y: overlay.y + dy } : { x: Math.min(Math.max(overlay.x + dx, 0), pageSize[0] - 20), y: Math.min(Math.max(overlay.y + dy, 0), pageSize[1] - 10) }
      }
      if (overlay.kind === 'ink') {
        return { points: overlay.points.map(([x, y]) => [x + dx, y + dy] as const) }
      }
      if (overlay.kind === 'shape') {
        // 네 모서리 손잡이: 맞은편 모서리를 붙든 채 크기를 바꾼다(Shift 면 정사각형·원). 몸통: 옮기기
        if (mode === 'nw' || mode === 'ne' || mode === 'sw' || mode === 'se' || mode === 'resize') {
          const corner = mode === 'resize' ? 'se' : mode
          const left = corner === 'nw' || corner === 'sw'
          const top = corner === 'nw' || corner === 'ne'
          const fixed = { x: left ? overlay.x + overlay.w : overlay.x, y: top ? overlay.y + overlay.h : overlay.y }
          const moved = { x: (left ? overlay.x : overlay.x + overlay.w) + dx, y: (top ? overlay.y : overlay.y + overlay.h) + dy }
          const box = shapeBox(fixed, clampPoint(moved, overlay.page), shift)
          return { x: box.x, y: box.y, w: Math.max(box.w, SHAPE_MIN_SIZE), h: Math.max(box.h, SHAPE_MIN_SIZE) }
        }
        return { x: overlay.x + dx, y: overlay.y + dy }
      }
      if (mode === 'end1' || mode === 'end2') {
        const base = mode === 'end1' ? { x: overlay.x1 + dx, y: overlay.y1 + dy } : { x: overlay.x2 + dx, y: overlay.y2 + dy }
        const fixed = mode === 'end1' ? { x: overlay.x2, y: overlay.y2 } : { x: overlay.x1, y: overlay.y1 }
        const end = shift ? { ...fixed, ...snapLineEnd(fixed, base) } : base
        const clamped = clampPoint(end, overlay.page)
        return mode === 'end1' ? { x1: clamped.x, y1: clamped.y } : { x2: clamped.x, y2: clamped.y }
      }
      return { x1: overlay.x1 + dx, y1: overlay.y1 + dy, x2: overlay.x2 + dx, y2: overlay.y2 + dy }
    }
    let last: OverlayPatch | null = null
    const onMove = (moveEvent: PointerEvent) => {
      last = patchFor(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey)
      setMoving({ id: overlay.id, patch: last })
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setMoving(null)
      if (last !== null) onUpdate(overlay.id, last)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const shown = [...overlays, ...(draft === null ? [] : [draft])].map((item) => moving?.id === item.id ? { ...item, ...moving.patch } as PdfOverlay : item)

  return (
    <div
      ref={rootRef}
      className={`pdf-overlay-layer${editMode ? ' pdf-overlay-layer-edit' : ''}`}
      data-overlay-tool={editMode ? tool : undefined}
      style={{ width, height }}
      onPointerDown={handleSurfaceDown}
      onPointerDownCapture={handleEraserDown}
    >
      <svg className="pdf-overlay-lines" width={width} height={height} aria-hidden="true">
        {shown.filter((item): item is PdfShape => item.kind === 'shape').map((shape) => {
          const layout = layoutOf(shape.page)
          const size = pageSizes[shape.page]
          if (layout === undefined || size === undefined || size[0] <= 0) return null
          const scale = layout.width / size[0]
          const box = { x: layout.left + shape.x * scale, y: layout.top + shape.y * scale, w: shape.w * scale, h: shape.h * scale }
          const strokeWidth = Math.max(shape.width * scale, 1)
          const look = {
            stroke: shape.color,
            strokeWidth,
            fill: shape.fill === true ? shape.color : 'none',
            fillOpacity: shape.fill === true ? 0.14 : undefined,
            strokeDasharray: dashArray(dashOf(shape), strokeWidth),
            strokeLinecap: dashOf(shape) === 'dot' ? 'round' as const : undefined,
          }
          const outline = (props: Record<string, unknown>) => shape.shape === 'ellipse'
            ? <ellipse cx={box.x + box.w / 2} cy={box.y + box.h / 2} rx={box.w / 2} ry={box.h / 2} {...props} />
            : <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={2} {...props} />
          return (
            <g key={shape.id} className={`pdf-overlay-line pdf-overlay-shape${shape.fill === true ? ' pdf-overlay-shape-filled' : ''}${selectedId === shape.id ? ' pdf-overlay-line-selected' : ''}`}>
              {outline(look)}
              {editMode ? outline({
                className: 'pdf-overlay-line-hit pdf-overlay-shape-hit',
                fill: 'transparent',
                'data-overlay-id': shape.id,
                onPointerDown: (event: React.PointerEvent<SVGElement>) => startMove(event as unknown as React.PointerEvent<HTMLElement>, shape, scale),
              }) : null}
              {editMode && selectedId === shape.id ? ([
                ['nw', box.x, box.y], ['ne', box.x + box.w, box.y], ['sw', box.x, box.y + box.h], ['se', box.x + box.w, box.y + box.h],
              ] as const).map(([corner, cx, cy]) => (
                <rect key={corner} className={`pdf-overlay-handle pdf-overlay-corner pdf-overlay-corner-${corner}`} x={cx - 4.5} y={cy - 4.5} width={9} height={9} rx={2.5} onPointerDown={(event) => startMove(event as unknown as React.PointerEvent<HTMLElement>, shape, scale, corner)} />
              )) : null}
            </g>
          )
        })}
        {shown.filter((item): item is PdfLine => item.kind === 'line').map((line) => {
          const layout = layoutOf(line.page)
          const size = pageSizes[line.page]
          if (layout === undefined || size === undefined || size[0] <= 0) return null
          const scale = layout.width / size[0]
          const p = (x: number, y: number) => `${layout.left + x * scale},${layout.top + y * scale}`
          const [a, b] = arrowHead(line)
          const [sa, sb] = arrowHead(line, true)
          const sw = Math.max(line.width * scale, 1)
          return (
            <g key={line.id} className={`pdf-overlay-line${selectedId === line.id ? ' pdf-overlay-line-selected' : ''}`}>
              <line x1={layout.left + line.x1 * scale} y1={layout.top + line.y1 * scale} x2={layout.left + line.x2 * scale} y2={layout.top + line.y2 * scale} stroke={line.color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dashArray(dashOf(line), sw)} />
              {line.arrow === true ? <polyline points={`${p(a.x, a.y)} ${p(line.x2, line.y2)} ${p(b.x, b.y)}`} fill="none" stroke={line.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {line.arrowStart === true ? <polyline points={`${p(sa.x, sa.y)} ${p(line.x1, line.y1)} ${p(sb.x, sb.y)}`} fill="none" stroke={line.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {editMode ? (
                <line
                  className="pdf-overlay-line-hit"
                  x1={layout.left + line.x1 * scale} y1={layout.top + line.y1 * scale} x2={layout.left + line.x2 * scale} y2={layout.top + line.y2 * scale}
                  data-overlay-id={line.id}
                  onPointerDown={(event) => startMove(event as unknown as React.PointerEvent<HTMLElement>, line, scale)}
                />
              ) : null}
              {editMode && selectedId === line.id ? (
                <>
                  <circle className="pdf-overlay-handle" cx={layout.left + line.x1 * scale} cy={layout.top + line.y1 * scale} r={5} onPointerDown={(event) => startMove(event as unknown as React.PointerEvent<HTMLElement>, line, scale, 'end1')} />
                  <circle className="pdf-overlay-handle" cx={layout.left + line.x2 * scale} cy={layout.top + line.y2 * scale} r={5} onPointerDown={(event) => startMove(event as unknown as React.PointerEvent<HTMLElement>, line, scale, 'end2')} />
                </>
              ) : null}
            </g>
          )
        })}
        {shown.filter((item): item is PdfInk => item.kind === 'ink').map((ink) => {
          const layout = layoutOf(ink.page)
          const size = pageSizes[ink.page]
          if (layout === undefined || size === undefined || size[0] <= 0) return null
          const scale = layout.width / size[0]
          const d = inkPath(ink.points, (x, y) => [layout.left + x * scale, layout.top + y * scale])
          return (
            <g key={ink.id} className={`pdf-overlay-line pdf-overlay-ink${selectedId === ink.id ? ' pdf-overlay-line-selected' : ''}`}>
              <path d={d} fill="none" stroke={ink.color} strokeWidth={Math.max(ink.width * scale, 1)} strokeLinecap="round" strokeLinejoin="round" />
              {editMode ? (
                <path
                  className="pdf-overlay-line-hit"
                  d={d}
                  fill="none"
                  data-overlay-id={ink.id}
                  onPointerDown={(event) => startMove(event as unknown as React.PointerEvent<HTMLElement>, ink, scale)}
                />
              ) : null}
            </g>
          )
        })}
        {inking === null ? null : (() => {
          const layout = layoutOf(inking.page)
          const size = pageSizes[inking.page]
          if (layout === undefined || size === undefined || size[0] <= 0) return null
          const scale = layout.width / size[0]
          return (
            <path
              className="pdf-overlay-line-preview"
              d={inkPath(inking.points, (x, y) => [layout.left + x * scale, layout.top + y * scale])}
              fill="none"
              stroke={style.color}
              strokeWidth={Math.max(style.lineWidth * scale, 1)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })()}
        {drawing === null ? null : (() => {
          const layout = layoutOf(drawing.page)
          const size = pageSizes[drawing.page]
          if (layout === undefined || size === undefined) return null
          const scale = layout.width / size[0]
          if (drawing.textBox === true) {
            const box = shapeBox(drawing.from, drawing.to)
            if (box.w < 4) return null
            return <rect className="pdf-overlay-text-preview" x={layout.left + box.x * scale} y={layout.top + box.y * scale} width={box.w * scale} height={Math.max(box.h * scale, style.textSize * scale * 1.6)} rx={2} />
          }
          const previewShape = shapeOfTool(tool)
          if (previewShape !== null) {
            const box = shapeBox(drawing.from, drawing.to, drawing.square === true)
            const psw = Math.max(style.lineWidth * scale, 1)
            const look = { stroke: style.color, strokeWidth: psw, fill: style.fill ? style.color : 'none', fillOpacity: style.fill ? 0.14 : undefined, strokeDasharray: dashArray(style.dash, psw), strokeLinecap: style.dash === 'dot' ? 'round' as const : undefined }
            return (
              <g className="pdf-overlay-line pdf-overlay-line-preview">
                {previewShape === 'ellipse'
                  ? <ellipse cx={layout.left + (box.x + box.w / 2) * scale} cy={layout.top + (box.y + box.h / 2) * scale} rx={box.w / 2 * scale} ry={box.h / 2 * scale} {...look} />
                  : <rect x={layout.left + box.x * scale} y={layout.top + box.y * scale} width={box.w * scale} height={box.h * scale} rx={2} {...look} />}
              </g>
            )
          }
          const withArrow = style.arrowEnd
          const preview = createLine(drawing.page, drawing.from, drawing.to, { color: style.color, width: style.lineWidth, arrow: withArrow, arrowStart: style.arrowStart })
          const [a, b] = arrowHead(preview)
          const [sa, sb] = arrowHead(preview, true)
          const lsw = Math.max(style.lineWidth * scale, 1)
          const p = (x: number, y: number) => `${layout.left + x * scale},${layout.top + y * scale}`
          return (
            <g className="pdf-overlay-line pdf-overlay-line-preview">
              <line x1={layout.left + drawing.from.x * scale} y1={layout.top + drawing.from.y * scale} x2={layout.left + drawing.to.x * scale} y2={layout.top + drawing.to.y * scale} stroke={style.color} strokeWidth={lsw} strokeLinecap="round" strokeDasharray={dashArray(style.dash, lsw)} />
              {style.arrowStart ? <polyline points={`${p(sa.x, sa.y)} ${p(drawing.from.x, drawing.from.y)} ${p(sb.x, sb.y)}`} fill="none" stroke={style.color} strokeWidth={lsw} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {withArrow ? <polyline points={`${p(a.x, a.y)} ${p(drawing.to.x, drawing.to.y)} ${p(b.x, b.y)}`} fill="none" stroke={style.color} strokeWidth={Math.max(style.lineWidth * scale, 1)} strokeLinecap="round" strokeLinejoin="round" /> : null}
            </g>
          )
        })()}
      </svg>

      {shown.filter((item): item is PdfTextBox => item.kind === 'text').map((box) => {
        const layout = layoutOf(box.page)
        const size = pageSizes[box.page]
        if (layout === undefined || size === undefined || size[0] <= 0) return null
        const scale = layout.width / size[0]
        const editing = editingId === box.id
        return (
          <div
            key={box.id}
            className={`pdf-overlay-text${selectedId === box.id ? ' pdf-overlay-text-selected' : ''}${editing ? ' pdf-overlay-text-editing' : ''}${box.border === true ? ' pdf-overlay-text-border' : ''}`}
            data-overlay-id={box.id}
            style={{
              left: layout.left + box.x * scale,
              top: layout.top + box.y * scale,
              width: box.w * scale,
              fontSize: `${box.size * scale}px`,
              color: box.color,
              fontWeight: box.bold === true ? 700 : 400,
              background: box.fill === undefined ? 'transparent' : FILL[box.fill],
            }}
            onPointerDown={(event) => {
              if (!editMode || editing) return
              startMove(event, box, scale)
            }}
            onDoubleClick={() => {
              if (!editMode) return
              if (editingId !== null && editingId !== box.id) commitEditingRef.current?.()
              setSelectedId(box.id)
              setEditingId(box.id)
            }}
          >
            {editing ? (
              <TextEditor
                initial={box.text}
                commitRef={commitEditingRef}
                onDone={(text) => {
                  setEditingId(null)
                  if (draft !== null && draft.id === box.id) {
                    setDraft(null)
                    if (text.trim() === '') setSelectedId(null)
                    else onAdd({ ...draft, text })
                    return
                  }
                  if (text.trim() === '') {
                    onRemove(box.id)
                    setSelectedId(null)
                  } else if (text !== box.text) onUpdate(box.id, { text })
                }}
              />
            ) : (
              <span className="pdf-overlay-text-body">{box.text}</span>
            )}
            {editMode && selectedId === box.id ? (
              <>
                <span
                  className="pdf-overlay-resize pdf-overlay-resize-left"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('글 상자 너비 조절(왼쪽)')}
                  onPointerDown={(event) => { event.stopPropagation(); if (editing) commitEditingRef.current?.(); startMove(event, box, scale, 'resize-left') }}
                />
                <span
                  className="pdf-overlay-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('글 상자 너비 조절')}
                  onPointerDown={(event) => { event.stopPropagation(); if (editing) commitEditingRef.current?.(); startMove(event, box, scale, 'resize') }}
                />
              </>
            ) : null}
          </div>
        )
      })}

      {editMode && selectedId !== null && moving === null ? (() => {
        const item = shown.find((candidate) => candidate.id === selectedId)
        if (item === undefined || item.kind === 'ink') return null
        const layout = layoutOf(item.page)
        const size = pageSizes[item.page]
        if (layout === undefined || size === undefined || size[0] <= 0) return null
        const scale = layout.width / size[0]
        const left = layout.left + (item.kind === 'line' ? Math.min(item.x1, item.x2) : item.x) * scale
        const top = layout.top + (item.kind === 'line' ? Math.min(item.y1, item.y2) : item.y) * scale
        const update = (patch: OverlayPatch) => onUpdate(item.id, patch)
        return (
          <div className="pdf-overlay-mini" role="toolbar" aria-label={t('고른 것 서식')} style={{ left, top: Math.max(top - 40, 2) }} onPointerDown={(event) => event.stopPropagation()}>
            {item.kind === 'text' ? (
              <>
                <button type="button" className={`pdf-overlay-mini-btn${item.bold === true ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('굵게')} aria-pressed={item.bold === true} title={t('굵게')} onClick={() => update({ bold: item.bold !== true })}><TextB size={14} weight="bold" /></button>
                <button type="button" className={`pdf-overlay-mini-btn${item.fill !== undefined ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('바탕')} title={t('바탕: 없음 → 흰색 → 노랑')} onClick={() => update({ fill: item.fill === undefined ? 'white' : item.fill === 'white' ? 'yellow' : undefined })}><span className="pdf-overlay-mini-swatch" style={{ background: item.fill === undefined ? 'transparent' : FILL[item.fill] }} /></button>
                <button type="button" className={`pdf-overlay-mini-btn${item.border === true ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('테두리')} aria-pressed={item.border === true} title={t('테두리')} onClick={() => update({ border: item.border !== true })}><BoundingBox size={14} /></button>
              </>
            ) : item.kind === 'shape' ? (
              <>
                <button type="button" className={`pdf-overlay-mini-btn${item.fill === true ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('안을 옅게 칠하기')} aria-pressed={item.fill === true} title={t('안을 옅게 칠하기')} onClick={() => update({ fill: item.fill !== true })}><PaintBucket size={14} /></button>
                <button type="button" className={`pdf-overlay-mini-btn${dashOf(item) !== 'solid' ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('점선')} title={t('선 모양: 실선 → 점선 → 짧은 점선')} onClick={() => update(dashPatch(dashOf(item) === 'solid' ? 'dash' : dashOf(item) === 'dash' ? 'dot' : 'solid'))}><span className={`pdf-overlay-mini-dash pdf-overlay-mini-dash-${dashOf(item)}`} /></button>
              </>
            ) : (
              <>
                <button type="button" className={`pdf-overlay-mini-btn${item.arrow === true ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('화살촉')} title={t('화살촉: 없음 → 끝 → 양쪽')} onClick={() => update(item.arrow !== true ? { arrow: true, arrowStart: undefined } : item.arrowStart !== true ? { arrowStart: true } : { arrow: undefined, arrowStart: undefined })}>{item.arrowStart === true ? <ArrowsHorizontal size={14} /> : <ArrowRight size={14} />}</button>
                <button type="button" className={`pdf-overlay-mini-btn${dashOf(item) !== 'solid' ? ' pdf-overlay-mini-on' : ''}`} aria-label={t('점선')} title={t('선 모양: 실선 → 점선 → 짧은 점선')} onClick={() => update(dashPatch(dashOf(item) === 'solid' ? 'dash' : dashOf(item) === 'dash' ? 'dot' : 'solid'))}><span className={`pdf-overlay-mini-dash pdf-overlay-mini-dash-${dashOf(item)}`} /></button>
              </>
            )}
            <span className="pdf-overlay-mini-sep" aria-hidden="true" />
            <button type="button" className="pdf-overlay-mini-btn" aria-label={t('고른 것 지우기')} title={t('지우기 (Delete)')} onClick={() => { onRemove(item.id); setSelectedId(null) }}><Trash size={14} /></button>
          </div>
        )
      })() : null}
    </div>
  )
}

/** 글 상자 안 글쓰기(일반 글). 다른 곳을 누르거나 Esc 면 끝난다 */
function TextEditor({ initial, onDone, commitRef }: {
  readonly initial: string
  readonly onDone: (text: string) => void
  /** 밖에서 「여기까지 저장하고 끝내기」를 부를 수 있게 */
  readonly commitRef: React.MutableRefObject<(() => void) | null>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(false)
  const textRef = useRef(initial)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    element.innerText = initial
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // 처음 한 번만 채운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const finish = (save: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    const text = ref.current?.isConnected === true ? ref.current.innerText : textRef.current
    onDoneRef.current(save ? text.replace(/\n+$/u, '') : initial)
  }
  // 밖에서 끝내기를 부를 수 있게 한다(빈 곳 누르기·다른 상자 고르기·모드 끄기는 포커스를 옮기지 않아 blur 가 오지 않는다)
  useLayoutEffect(() => {
    commitRef.current = () => finish(true)
    return () => { commitRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={ref}
      className="pdf-overlay-editor"
      role="textbox"
      aria-multiline="true"
      aria-label={t('글 상자')}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onPointerDown={(event) => event.stopPropagation()}
      onInput={(event) => { textRef.current = event.currentTarget.innerText }}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(initial.trim() !== '')
        }
      }}
    />
  )
}
