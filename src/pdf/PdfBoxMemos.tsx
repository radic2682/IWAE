import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, CaretRight, DotsSixVertical, NotePencil, PencilSimple, Trash } from '@phosphor-icons/react'
import { BOX_MAX_WIDTH, BOX_MIN_WIDTH, boxConnector, clampBox, type MemoBox } from '../core/boxMemo'
import type { PdfHighlightColor, PersistentPdfHighlight } from './persistentHighlight'
import { MemoEditor, MemoNoteView, type MemoContent } from './MemoEditor'
import { t } from '../i18n'
import { useHighlightColors } from '../app/highlightColorStyle'
import { highlightColorLabel } from '../core/highlightColors'
import '../ui/pdf-box-memo.css'
import '../ui/context-menu.css'

export interface BoxPageLayout {
  /** 문서 안 이 쪽의 위쪽(px) */
  readonly top: number
  /** 쪽 왼쪽(px, 문서 내용 폭 기준) */
  readonly left: number
  /** 쪽 폭(px) */
  readonly width: number
}

interface PdfBoxMemosProps {
  readonly memos: readonly PersistentPdfHighlight[]
  /** 아직 저장 전인 새 박스(글을 써야 저장된다) */
  readonly draftId: string | null
  readonly editingId: string | null
  readonly pageSizes: readonly (readonly [number, number])[]
  readonly layoutOf: (page: number) => BoxPageLayout | undefined
  readonly width: number
  readonly height: number
  readonly onEdit: (id: string | null) => void
  readonly onSave: (id: string, content: MemoContent) => void
  readonly onCancelDraft: () => void
  readonly onChange: (id: string, patch: { box?: MemoBox; collapsed?: boolean; color?: PdfHighlightColor }) => void
  readonly onDelete: (id: string) => void
  /** 우클릭 「노트로 보내기」: 박스를 거두고 열린 노트의 메모 카드로 옮긴다 */
  readonly onSendToNote?: (id: string) => void
}

/**
 * 선의 시작점(쪽 좌표): 형광펜의 네 끝(첫 줄 왼쪽·오른쪽, 마지막 줄 왼쪽·오른쪽) 가운데 박스에 가장 가까운 곳.
 * 박스가 왼쪽에 있으면 글 앞, 오른쪽이면 글 끝, 아래면 마지막 줄에서 선이 나간다
 */
export function anchorPoint(memo: PersistentPdfHighlight, box?: MemoBox, boxHeight = 40): { x: number; y: number } {
  const rects = memo.anchor.rects
  const top = Math.min(...rects.map((rect) => rect.y))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h))
  const firstLine = rects.filter((rect) => rect.y < top + 2)
  const lastLine = rects.filter((rect) => rect.y + rect.h > bottom - 2)
  const firstH = Math.min(Math.max(...firstLine.map((rect) => rect.h)), 14)
  const lastH = Math.min(Math.max(...lastLine.map((rect) => rect.h)), 14)
  const candidates = [
    { x: Math.max(...firstLine.map((rect) => rect.x + rect.w)), y: top + firstH / 2 },
    { x: Math.min(...firstLine.map((rect) => rect.x)), y: top + firstH / 2 },
    { x: Math.max(...lastLine.map((rect) => rect.x + rect.w)), y: bottom - lastH / 2 },
    { x: Math.min(...lastLine.map((rect) => rect.x)), y: bottom - lastH / 2 },
  ]
  if (box === undefined) return candidates[0]!
  // 박스 사각형까지의 거리
  const distance = (point: { x: number; y: number }) => {
    const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w))
    const dy = Math.max(box.y - point.y, 0, point.y - (box.y + boxHeight))
    return Math.hypot(dx, dy)
  }
  return candidates.reduce((best, point) => (distance(point) < distance(best) - 0.5 ? point : best))
}

/**
 * PDF 쪽 위에 떠 있는 박스 메모들과, 형광펜 끝에서 박스로 가는 연결선. 박스는 머리(⠿)를 끌어 옮기고, 오른쪽 가장자리를 끌어 너비를 바꾼다.
 * 메모 바·노트로는 가지 않는다. 눈 단추(깨끗이 보기)가 켜져 있으면 CSS 로 함께 감춘다.
 */
export function PdfBoxMemos({ memos, draftId, editingId, pageSizes, layoutOf, width, height, onEdit, onSave, onCancelDraft, onChange, onDelete, onSendToNote }: PdfBoxMemosProps) {
  const colors = useHighlightColors()
  // 우클릭 메뉴(화면 좌표)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (menu === null) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Element && event.target.closest('.pdf-box-menu') !== null) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])
  // 끄는 중인 박스(놓을 때 한 번만 저장한다)
  const [drag, setDrag] = useState<{ id: string; box: MemoBox } | null>(null)
  // 카드 높이(연결선 끝을 맞추려고 잰다)
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({})
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    for (const [id, element] of cardRefs.current) next[id] = element.offsetHeight
    const same = Object.keys(next).length === Object.keys(heights).length && Object.entries(next).every(([id, value]) => heights[id] === value)
    if (!same) setHeights(next)
  })

  const startDrag = (event: React.PointerEvent<HTMLElement>, memo: PersistentPdfHighlight, mode: 'move' | 'resize' | 'corner', scale: number, pageSize: readonly [number, number]) => {
    if (event.button !== 0 || memo.box === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    // 모서리: 지금 보이는 카드 높이에서 출발한다(최소 높이를 아직 안 정했어도)
    const card = target.closest('.pdf-box-card')
    const shownHeight = card instanceof HTMLElement ? card.offsetHeight / scale : memo.box.h ?? 40
    const start = { x: event.clientX, y: event.clientY, box: memo.box, h: shownHeight }
    const moveTo = (clientX: number, clientY: number): MemoBox => {
      const dx = (clientX - start.x) / scale
      const dy = (clientY - start.y) / scale
      if (mode === 'move') return clampBox({ ...start.box, x: start.box.x + dx, y: start.box.y + dy }, pageSize)
      const width = Math.min(Math.max(start.box.w + dx, BOX_MIN_WIDTH), BOX_MAX_WIDTH)
      return mode === 'corner'
        ? clampBox({ ...start.box, w: width, h: Math.max(start.h + dy, 24) }, pageSize)
        : clampBox({ ...start.box, w: width }, pageSize)
    }
    let last = start.box
    const onMove = (moveEvent: PointerEvent) => {
      last = moveTo(moveEvent.clientX, moveEvent.clientY)
      setDrag({ id: memo.id, box: last })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setDrag(null)
      if (last !== start.box) onChange(memo.id, { box: last })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const placed = memos.flatMap((memo) => {
    const box = drag?.id === memo.id ? drag.box : memo.box
    const layout = layoutOf(memo.anchor.page)
    const pageSize = pageSizes[memo.anchor.page]
    if (box === undefined || layout === undefined || pageSize === undefined || pageSize[0] <= 0) return []
    return [{ memo, box, layout, pageSize, scale: layout.width / pageSize[0] }]
  })

  return (
    <div className="pdf-box-layer" style={{ width, height }}>
      <svg className="pdf-box-links" width={width} height={height} aria-hidden="true">
        {placed.map(({ memo, box, layout, scale }) => {
          const boxHeight = (heights[memo.id] ?? 60) / scale
          const line = boxConnector(anchorPoint(memo, box, boxHeight), box, boxHeight)
          const px = (point: { x: number; y: number }) => ({ x: layout.left + point.x * scale, y: layout.top + point.y * scale })
          const from = px(line.from)
          const to = px(line.to)
          return (
            <g key={memo.id} className="pdf-box-link" data-hl={memo.color}>
              <path d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} />
              <circle cx={from.x} cy={from.y} r={2.6} />
              <circle className="pdf-box-link-end" cx={to.x} cy={to.y} r={2.6} />
            </g>
          )
        })}
      </svg>
      {placed.map(({ memo, box, layout, pageSize, scale }) => {
        const editing = editingId === memo.id || memo.id === draftId
        const collapsed = memo.collapsed === true && !editing
        return (
          <div
            key={memo.id}
            ref={(element) => {
              if (element === null) cardRefs.current.delete(memo.id)
              else cardRefs.current.set(memo.id, element)
            }}
            data-hl={memo.color}
            className={`pdf-box-card${editing ? ' pdf-box-card-editing' : ''}${drag?.id === memo.id ? ' pdf-box-card-dragging' : ''}`}
            data-box-memo={memo.id}
            style={{
              left: layout.left + box.x * scale,
              top: layout.top + box.y * scale,
              width: box.w * scale,
              minHeight: box.h === undefined ? undefined : box.h * scale,
              // 글은 읽을 만한 크기로(쪽 배율을 따르되 12–16px)
              fontSize: `${Math.min(Math.max(10.5 * scale, 12), 16)}px`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.stopPropagation()
              // 글을 쓰는 중에는 글 상자의 기본 메뉴(붙여 넣기 등)를 둔다
              if (editing) return
              event.preventDefault()
              setMenu({ id: memo.id, x: event.clientX, y: event.clientY })
            }}
          >
            {/* 옮기기·색·지우기: 박스 위 오른쪽 바깥에 떠 있다(박스 안에는 글만) */}
            <div
              className="pdf-box-head pdf-box-tools"
              onPointerDown={(event) => {
                if (event.target instanceof Element && event.target.closest('button') !== null) return
                startDrag(event, memo, 'move', scale, pageSize)
              }}
            >
              <span
                className="pdf-box-grip"
                role="button"
                aria-label={t('박스 옮기기')}
                title={t('끌어서 옮기기')}
              >
                <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
              </span>
              <span className="pdf-box-colors" role="group" aria-label={t('색')}>
                {colors.map(({ id: color }) => (
                  <button
                    key={color}
                    type="button"
                    data-hl={color}
                    className={`pdf-box-color${memo.color === color ? ' pdf-box-color-on' : ''}`}
                    aria-label={t('색 {color}', { color: highlightColorLabel(colors, color) })}
                    aria-pressed={memo.color === color}
                    onClick={() => onChange(memo.id, { color })}
                  />
                ))}
              </span>
              <button type="button" className="pdf-box-btn" aria-label={t('박스 메모 지우기')} title={t('지우기')} onClick={() => (memo.id === draftId ? onCancelDraft() : onDelete(memo.id))}>
                <Trash size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="pdf-box-body">
              {editing ? (
                <MemoEditor
                  key={memo.id}
                  initialText={memo.note ?? ''}
                  initialHtml={memo.noteHtml}
                  placeholder={t('박스 메모 (Esc 취소 · 다른 곳을 누르면 저장)')}
                  onSave={(content) => {
                    onSave(memo.id, content)
                    onEdit(null)
                  }}
                  onCancel={() => {
                    if (memo.id === draftId) onCancelDraft()
                    onEdit(null)
                  }}
                />
              ) : (
                <MemoNoteView note={memo.note} noteHtml={memo.noteHtml} onEdit={() => onEdit(memo.id)} onChange={(content) => onSave(memo.id, content)} />
              )}
            </div>
            <span
              className="pdf-box-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('박스 너비 조절')}
              title={t('끌어서 너비 조절')}
              onPointerDown={(event) => startDrag(event, memo, 'resize', scale, pageSize)}
            />
            <span
              className="pdf-box-resize-corner"
              role="separator"
              aria-label={t('박스 크기 조절')}
              title={t('끌어서 크기 조절')}
              onPointerDown={(event) => startDrag(event, memo, 'corner', scale, pageSize)}
            />
          </div>
        )
      })}
      {menu === null ? null : createPortal(
        // 다른 우클릭 메뉴와 같은 꼴(아이콘 칸 + 글 칸)
        <div className="pdf-box-menu app-context-menu" role="menu" aria-label={t('박스 메모')} style={{ left: menu.x, top: menu.y }}>
          {menu.id === draftId ? null : (
            <button type="button" role="menuitem" onClick={() => { onEdit(menu.id); setMenu(null) }}>
              <span className="app-context-icon" aria-hidden="true"><PencilSimple size={15} /></span><span className="app-context-label">{t('글 고치기')}</span>
            </button>
          )}
          {onSendToNote === undefined || menu.id === draftId ? null : (
            <button type="button" role="menuitem" onClick={() => { onSendToNote(menu.id); setMenu(null) }}>
              <span className="app-context-icon" aria-hidden="true"><NotePencil size={15} /></span><span className="app-context-label">{t('노트로 보내기')}</span>
            </button>
          )}
          <hr className="app-context-sep" />
          <button type="button" role="menuitem" className="app-context-danger" onClick={() => { if (menu.id === draftId) onCancelDraft(); else onDelete(menu.id); setMenu(null) }}>
            <span className="app-context-icon" aria-hidden="true"><Trash size={15} /></span><span className="app-context-label">{t('박스 메모 지우기')}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}
