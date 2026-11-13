import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { NotePencil, Trash } from '@phosphor-icons/react'
import type { PdfHighlightColor, PersistentPdfHighlight } from './persistentHighlight'
import { HIGHLIGHT_NOTE_LIMIT } from './persistentHighlight'
import { useHighlightColors } from '../app/documents/highlightColorStyle'
import { highlightColorLabel } from '../core/highlightColors'
import '../ui/highlight-popover.css'

const WIDTH = 300
const EDGE = 8
/** 입력을 멈추고 이만큼 지나면 메모를 저장한다 */
const NOTE_SAVE_DELAY_MS = 600

interface HighlightPopoverProps {
  readonly highlight: PersistentPdfHighlight
  /** 클릭한 화면 좌표. 창 밖으로 넘치면 안쪽으로 당긴다 */
  readonly point: { readonly x: number; readonly y: number }
  readonly onUpdate: (id: string, patch: { color?: PdfHighlightColor; note?: string }) => void
  readonly onDelete: (id: string) => void
  readonly onClose: () => void
  /** 열린 노트가 있을 때만 보인다 */
  readonly onSendToCanvas?: (highlight: PersistentPdfHighlight) => void
}

/**
 * 형광펜 하나의 메모 창. 메모는 따로 "저장" 버튼 없이 입력을 멈추거나 창을 떠날 때
 * 저장한다 — 저장 버튼을 두면 닫다가 잃어버리는 메모가 생긴다.
 */
export function HighlightPopover({ highlight, point, onUpdate, onDelete, onClose, onSendToCanvas }: HighlightPopoverProps) {
  const colors = useHighlightColors()
  const [note, setNote] = useState(highlight.note ?? '')
  const savedNoteRef = useRef(highlight.note ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = (value: string) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (value === savedNoteRef.current) return
    savedNoteRef.current = value
    onUpdate(highlight.id, { note: value })
  }

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const left = Math.max(EDGE, Math.min(point.x, window.innerWidth - WIDTH - EDGE))
  const top = Math.max(EDGE, Math.min(point.y + 12, window.innerHeight - 260))

  return (
    <>
      <div className="highlight-popover-backdrop" onPointerDown={() => { flush(note); onClose() }} />
      <div
        className="highlight-popover"
        role="dialog"
        aria-label={t('형광펜')}
        style={{ left, top, width: WIDTH }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          flush(note)
          onClose()
        }}
      >
        <blockquote className="highlight-popover-quote" data-hl={highlight.color}>
          {highlight.anchor.quote}
        </blockquote>
        <div className="highlight-popover-colors" aria-label={t('형광펜 색상')}>
          {colors.map(({ id: color }) => (
            <button
              key={color}
              type="button"
              data-hl={color}
              className="pdf-highlighter-color"
              aria-label={t('{color} 형광펜', { color: highlightColorLabel(colors, color) })}
              aria-pressed={highlight.color === color}
              onClick={() => onUpdate(highlight.id, { color })}
            />
          ))}
        </div>
        <textarea
          className="highlight-popover-note"
          aria-label={t('형광펜 메모')}
          placeholder={t('메모')}
          value={note}
          maxLength={HIGHLIGHT_NOTE_LIMIT}
          autoFocus
          rows={3}
          onChange={(event) => {
            const value = event.target.value
            setNote(value)
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => flush(value), NOTE_SAVE_DELAY_MS)
          }}
          onBlur={() => flush(note)}
        />
        <div className="highlight-popover-actions">
          {onSendToCanvas !== undefined ? (
            <button type="button" onClick={() => { flush(note); onSendToCanvas(highlight) }}>
              <NotePencil size={14} aria-hidden="true" />
              {t('노트로 보내기')}
            </button>
          ) : null}
          <button type="button" className="highlight-popover-delete" aria-label={t('형광펜 삭제')} onClick={() => onDelete(highlight.id)}>
            <Trash size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  )
}
