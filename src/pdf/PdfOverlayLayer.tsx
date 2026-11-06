import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  createInk, createLine, createTextBox, inkPath, isMeaningfulLine, snapLineEnd, TEXT_BOX_MIN_WIDTH,
  type OverlayColor, type OverlayPatch, type PdfInk, type PdfLine, type PdfOverlay, type PdfTextBox,
} from '../core/pdfOverlays'
import type { BoxPageLayout } from './PdfBoxMemos'
import '../ui/pdf-overlay.css'
import { t } from '../i18n'

export type OverlayTool = 'text' | 'pen' | 'eraser' | 'line'

export interface OverlayStyle {
  readonly color: OverlayColor
  readonly textSize: number
  readonly lineWidth: number
  /** 새 선에 화살촉 */
  readonly arrow: boolean
  /** 새 선을 점선으로 */
  readonly dashed: boolean
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
  /** 고른 덮개(서식은 위 떠 있는 도구창에서 바꾼다). 주면 고르기를 밖에서 쥔다 */
  readonly selectedId?: string | null
  readonly onSelect?: (id: string | null) => void
}

type Point = { x: number; y: number }

const FILL: Record<NonNullable<PdfTextBox['fill']>, string> = { white: '#ffffff', yellow: '#fff3a8' }

/** 화살촉 두 변의 끝점(쪽 좌표) */
function arrowHead(line: PdfLine): [Point, Point] {
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1)
  const size = Math.max(6, line.width * 4)
  const spread = Math.PI / 7
  return [
    { x: line.x2 - Math.cos(angle - spread) * size, y: line.y2 - Math.sin(angle - spread) * size },
    { x: line.x2 - Math.cos(angle + spread) * size, y: line.y2 - Math.sin(angle + spread) * size },
  ]
}

/**
 * PDF 위에 직접 쓰는 글 상자와 선(덮개 층). 편집 모드에서 글 상자 도구는 누른 자리에, 선·화살표 도구는 끌어서 그린다(Shift 면 수평·수직·45°).
 * 만든 것은 눌러 고르고 끌어 옮기며, 고르면 위에 속성 막대(색·크기·굵기·화살표·지우기)가 뜬다. Delete 로도 지운다.
 */
export function PdfOverlayLayer({ overlays, pageSizes, layoutOf, width, height, editMode, tool, style, onAdd, onUpdate, onRemove, selectedId: controlledSelected, onSelect }: PdfOverlayLayerProps) {
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
  const [drawing, setDrawing] = useState<{ page: number; from: Point; to: Point } | null>(null)
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
      const box = createTextBox(hit.page, hit.point.x, hit.point.y, { color: style.color, size: style.textSize })
      setDraft(box)
      setSelectedId(box.id)
      setEditingId(box.id)
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
    setDrawing({ page, from, to: from })
    const onMove = (moveEvent: PointerEvent) => {
      const at = pageAt(moveEvent.clientX, moveEvent.clientY)
      const raw = at === null ? from : clampPoint(at.page === page ? at.point : from, page)
      setDrawing({ page, from, to: moveEvent.shiftKey ? snapLineEnd(from, raw) : raw })
    }
    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const at = pageAt(upEvent.clientX, upEvent.clientY)
      const raw = at === null || at.page !== page ? from : clampPoint(at.point, page)
      const to = upEvent.shiftKey ? snapLineEnd(from, raw) : raw
      setDrawing(null)
      if (upEvent.type === 'pointercancel' || !isMeaningfulLine(from, to)) return
      const line = createLine(page, from, to, { color: style.color, width: style.lineWidth, arrow: style.arrow, dashed: style.dashed })
      onAdd(line)
      setSelectedId(line.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  /** 덮개를 끌어 옮긴다(글 상자는 가장자리·머리, 선은 어디든). dx, dy 를 쪽 좌표로 바꿔 임시 값으로 보이다가 놓을 때 저장 */
  const startMove = (event: React.PointerEvent<HTMLElement>, overlay: PdfOverlay, scale: number, mode: 'move' | 'resize' | 'end1' | 'end2' = 'move') => {
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
        return pageSize === undefined ? { x: overlay.x + dx, y: overlay.y + dy } : { x: Math.min(Math.max(overlay.x + dx, 0), pageSize[0] - 20), y: Math.min(Math.max(overlay.y + dy, 0), pageSize[1] - 10) }
      }
      if (overlay.kind === 'ink') {
        return { points: overlay.points.map(([x, y]) => [x + dx, y + dy] as const) }
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
        {shown.filter((item): item is PdfLine => item.kind === 'line').map((line) => {
          const layout = layoutOf(line.page)
          const size = pageSizes[line.page]
          if (layout === undefined || size === undefined || size[0] <= 0) return null
          const scale = layout.width / size[0]
          const p = (x: number, y: number) => `${layout.left + x * scale},${layout.top + y * scale}`
          const [a, b] = arrowHead(line)
          return (
            <g key={line.id} className={`pdf-overlay-line${selectedId === line.id ? ' pdf-overlay-line-selected' : ''}`}>
              <line x1={layout.left + line.x1 * scale} y1={layout.top + line.y1 * scale} x2={layout.left + line.x2 * scale} y2={layout.top + line.y2 * scale} stroke={line.color} strokeWidth={Math.max(line.width * scale, 1)} strokeLinecap="round" strokeDasharray={line.dashed === true ? `${line.width * scale * 3} ${line.width * scale * 2}` : undefined} />
              {line.arrow === true ? <polyline points={`${p(a.x, a.y)} ${p(line.x2, line.y2)} ${p(b.x, b.y)}`} fill="none" stroke={line.color} strokeWidth={Math.max(line.width * scale, 1)} strokeLinecap="round" strokeLinejoin="round" /> : null}
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
          const preview = createLine(drawing.page, drawing.from, drawing.to, { color: style.color, width: style.lineWidth, arrow: style.arrow })
          const [a, b] = arrowHead(preview)
          const p = (x: number, y: number) => `${layout.left + x * scale},${layout.top + y * scale}`
          return (
            <g className="pdf-overlay-line pdf-overlay-line-preview">
              <line x1={layout.left + drawing.from.x * scale} y1={layout.top + drawing.from.y * scale} x2={layout.left + drawing.to.x * scale} y2={layout.top + drawing.to.y * scale} stroke={style.color} strokeWidth={Math.max(style.lineWidth * scale, 1)} strokeLinecap="round" />
              {style.arrow ? <polyline points={`${p(a.x, a.y)} ${p(drawing.to.x, drawing.to.y)} ${p(b.x, b.y)}`} fill="none" stroke={style.color} strokeWidth={Math.max(style.lineWidth * scale, 1)} strokeLinecap="round" strokeLinejoin="round" /> : null}
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
            {editMode && selectedId === box.id && !editing ? (
              <span
                className="pdf-overlay-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={t('글 상자 너비 조절')}
                onPointerDown={(event) => startMove(event, box, scale, 'resize')}
              />
            ) : null}
          </div>
        )
      })}

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
