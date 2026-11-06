import type { ReactNode } from 'react'
import { ArrowRight, Check, Eraser, LineSegment, Minus, PencilSimple, Plus, TextB, Textbox, Trash } from '@phosphor-icons/react'
import { LINE_WIDTHS, OVERLAY_COLORS, TEXT_SIZES, type OverlayColor, type OverlayPatch, type PdfOverlay, type PdfTextBox } from '../core/pdfOverlays'
import type { OverlayStyle, OverlayTool } from './PdfOverlayLayer'
import { t } from '../i18n'
import '../ui/pdf-overlay.css'

/** PDF 위 떠 있는 도구창 틀(편집·박스 메모가 같은 모양을 쓴다) */
export function PdfFloatPalette({ label, children, onDone }: { readonly label: string; readonly children: ReactNode; readonly onDone: () => void }) {
  return (
    <div className="pdf-overlay-palette" role="toolbar" aria-label={label} onPointerDown={(event) => event.stopPropagation()}>
      {children}
      <span className="pdf-overlay-palette-sep" aria-hidden="true" />
      <button type="button" className="pdf-overlay-btn pdf-overlay-done" aria-label={t('{label} 끝내기', { label })} title={t('끝내기')} onClick={onDone}>
        <Check size={15} weight="bold" aria-hidden="true" /> {t('완료')}
      </button>
    </div>
  )
}

interface PdfOverlayPaletteProps {
  readonly tool: OverlayTool
  readonly style: OverlayStyle
  /** (예전) 도구창 안에서 도구 바꾸기. 이제 도구는 도구줄에 있어 쓰지 않는다 */
  readonly onToolChange?: (tool: OverlayTool) => void
  readonly onStyleChange: (patch: Partial<OverlayStyle>) => void
  /** 고른 덮개. 있으면 서식 단추가 그것을 바꾼다(없으면 새로 만들 것의 서식) */
  readonly selected?: PdfOverlay | null
  readonly onUpdateSelected?: (patch: OverlayPatch) => void
  readonly onRemoveSelected?: () => void
  readonly onDone: () => void
}

const FILL_OPTIONS: readonly { value: PdfTextBox['fill']; label: string; swatch: string }[] = [
  { value: undefined, label: '바탕 없음', swatch: 'transparent' },
  { value: 'white', label: '흰 바탕(아래 글 가리기)', swatch: '#ffffff' },
  { value: 'yellow', label: '노란 바탕', swatch: '#fff3a8' },
]

function step(values: readonly number[], current: number, direction: 1 | -1): number {
  const index = values.findIndex((value) => value >= current)
  const at = index < 0 ? values.length - 1 : index
  return values[Math.min(Math.max(at + direction, 0), values.length - 1)] ?? current
}

/**
 * PDF 편집 도구창(PDF 위 가운데 위쪽): 도구(글 상자 · 펜 · 지우개 · 선) | 색 | 크기·굵기 | 고른 것에 맞는 서식 | 지우기 | 완료.
 * 무엇을 고른 채면 서식이 그것에 바로 걸리고, 아무것도 안 고르면 새로 만들 것의 서식이다.
 */
/** 편집 도구 넷(문서 도구줄에 단추로 나온다). 그림은 읽기 도구(텍스트 선택 T 등)와 겹치지 않게 고른다 */
export const OVERLAY_TOOLS: readonly { id: OverlayTool; label: string; icon: (size: number, active: boolean) => ReactNode }[] = [
  { id: 'text', label: '글 상자', icon: (size, active) => <Textbox size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'pen', label: '펜', icon: (size, active) => <PencilSimple size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'eraser', label: '지우개', icon: (size, active) => <Eraser size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'line', label: '선', icon: (size, active) => <LineSegment size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
]

export function PdfOverlayPalette({ tool, style, onStyleChange, selected = null, onUpdateSelected, onRemoveSelected, onDone }: PdfOverlayPaletteProps) {
  // 서식 대상: 고른 덮개, 없으면 지금 도구로 새로 만들 것
  const target: 'text' | 'stroke' | 'line' | null = selected !== null
    ? selected.kind === 'text' ? 'text' : selected.kind === 'line' ? 'line' : 'stroke'
    : tool === 'text' ? 'text' : tool === 'line' ? 'line' : tool === 'pen' ? 'stroke' : null
  const color: OverlayColor = selected?.color ?? style.color
  const setColor = (next: OverlayColor) => (selected !== null ? onUpdateSelected?.({ color: next }) : onStyleChange({ color: next }))
  const textSize = selected?.kind === 'text' ? selected.size : style.textSize
  const lineWidth = selected !== null && selected.kind !== 'text' ? selected.width : style.lineWidth
  const setTextSize = (size: number) => (selected?.kind === 'text' ? onUpdateSelected?.({ size }) : onStyleChange({ textSize: size }))
  const setLineWidth = (width: number) => (selected !== null && selected.kind !== 'text' ? onUpdateSelected?.({ width }) : onStyleChange({ lineWidth: width }))
  const arrow = selected?.kind === 'line' ? selected.arrow === true : style.arrow
  const dashed = selected?.kind === 'line' ? selected.dashed === true : style.dashed

  return (
    <PdfFloatPalette label={t('PDF 편집')} onDone={onDone}>
      {/* 도구(글 상자·펜·지우개·선)는 문서 도구줄에 있다. 여기는 지금 도구 이름과 서식만 */}
      <span className="pdf-box-palette-label">{selected !== null ? t('고른 것') : t(OVERLAY_TOOLS.find((item) => item.id === tool)?.label ?? '')}</span>
      {target === null ? null : (
        <>
          <span className="pdf-overlay-palette-sep" aria-hidden="true" />
          <span className="pdf-overlay-colors" role="group" aria-label={t('색')}>
            {OVERLAY_COLORS.map((value) => (
              <button key={value} type="button" className={`pdf-overlay-color${color === value ? ' pdf-overlay-color-on' : ''}`} style={{ background: value }} aria-label={t('색 {value}', { value })} aria-pressed={color === value} title={t('색')} onClick={() => setColor(value)} />
            ))}
          </span>
          <span className="pdf-overlay-palette-sep" aria-hidden="true" />
          {target === 'text' ? (
            <span className="pdf-overlay-group" role="group" aria-label={t('글자 크기')}>
              <button type="button" className="pdf-overlay-btn" aria-label={t('글자 작게')} title={t('글자 작게')} onClick={() => setTextSize(step(TEXT_SIZES, textSize, -1))}><Minus size={13} aria-hidden="true" /></button>
              <span className="pdf-overlay-size" title={t('글자 크기(pt)')}>{textSize}</span>
              <button type="button" className="pdf-overlay-btn" aria-label={t('글자 크게')} title={t('글자 크게')} onClick={() => setTextSize(step(TEXT_SIZES, textSize, 1))}><Plus size={13} aria-hidden="true" /></button>
            </span>
          ) : (
            <span className="pdf-overlay-group" role="group" aria-label={t('선 굵기')}>
              {LINE_WIDTHS.map((width) => (
                <button key={width} type="button" className={`pdf-overlay-btn pdf-overlay-width${lineWidth === width ? ' pdf-overlay-btn-on' : ''}`} aria-label={t('굵기 {width}', { width })} aria-pressed={lineWidth === width} title={t('굵기 {width}', { width })} onClick={() => setLineWidth(width)}>
                  <i style={{ height: Math.max(width, 1) }} />
                </button>
              ))}
            </span>
          )}
          {target === 'text' && selected?.kind === 'text' ? (
            <>
              <span className="pdf-overlay-palette-sep" aria-hidden="true" />
              <button type="button" className={`pdf-overlay-btn${selected.bold === true ? ' pdf-overlay-btn-on' : ''}`} aria-label={t('굵게')} aria-pressed={selected.bold === true} title={t('굵게')} onClick={() => onUpdateSelected?.({ bold: selected.bold !== true })}><TextB size={15} weight="bold" aria-hidden="true" /></button>
              <span className="pdf-overlay-group pdf-overlay-fills" role="group" aria-label={t('바탕')}>
                {FILL_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`pdf-overlay-fill${selected.fill === option.value ? ' pdf-overlay-color-on' : ''}${option.value === undefined ? ' pdf-overlay-fill-none' : ''}`}
                    style={{ background: option.swatch }}
                    aria-label={t(option.label)}
                    aria-pressed={selected.fill === option.value}
                    title={t(option.label)}
                    onClick={() => onUpdateSelected?.(option.value === undefined ? { fill: undefined } : { fill: option.value })}
                  />
                ))}
              </span>
              <button type="button" className={`pdf-overlay-btn${selected.border === true ? ' pdf-overlay-btn-on' : ''}`} aria-label={t('테두리')} aria-pressed={selected.border === true} title={t('테두리')} onClick={() => onUpdateSelected?.({ border: selected.border !== true })}>
                <span className="pdf-overlay-border-icon" aria-hidden="true" />
              </button>
            </>
          ) : null}
          {target === 'line' ? (
            <>
              <span className="pdf-overlay-palette-sep" aria-hidden="true" />
              <button type="button" className={`pdf-overlay-btn${arrow ? ' pdf-overlay-btn-on' : ''}`} aria-label={t('화살표')} aria-pressed={arrow} title={t('끝에 화살표')} onClick={() => (selected?.kind === 'line' ? onUpdateSelected?.({ arrow: !arrow }) : onStyleChange({ arrow: !arrow }))}><ArrowRight size={15} aria-hidden="true" /></button>
              <button type="button" className={`pdf-overlay-btn${dashed ? ' pdf-overlay-btn-on' : ''}`} aria-label={t('점선')} aria-pressed={dashed} title={t('점선')} onClick={() => (selected?.kind === 'line' ? onUpdateSelected?.({ dashed: !dashed }) : onStyleChange({ dashed: !dashed }))}>
                <span className="pdf-overlay-dash-icon" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </>
      )}
      {selected !== null && onRemoveSelected !== undefined ? (
        <>
          <span className="pdf-overlay-palette-sep" aria-hidden="true" />
          <button type="button" className="pdf-overlay-btn pdf-overlay-delete" aria-label={t('고른 것 지우기')} title={t('지우기 (Delete)')} onClick={onRemoveSelected}><Trash size={15} aria-hidden="true" /></button>
        </>
      ) : null}
    </PdfFloatPalette>
  )
}
