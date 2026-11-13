import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Eye, EyeSlash, File, Funnel, Rows } from '@phosphor-icons/react'
import { PDF_SPLIT_LAYOUTS, pdfSplitLayout, type PdfSplitLayout, type PdfSplitLayoutId } from '../core/pdfSplit'
import type { LayoutPresetDef, LayoutPresetId } from './layoutPresets'
import type { PdfSpread } from '../core/pdfViewPrefs'
import { t } from '../i18n'

export interface PdfPageLayout {
  readonly spread: PdfSpread
  readonly continuous: boolean
}

/** 세 장 보기: 쪽 세 장을 나란히 */
export function ThreePagesIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinejoin="round" aria-hidden="true">
      <rect x="20" y="52" width="60" height="152" rx="8" />
      <rect x="98" y="52" width="60" height="152" rx="8" />
      <rect x="176" y="52" width="60" height="152" rx="8" />
    </svg>
  )
}

/**
 * 고르기 목록의 배치 미리보기(가로로 긴 창 모양): 칸마다 옅게 칠한 둥근 네모, 칸 머리에 짧은 줄(탭·제목 자리)을 그려
 * 「창이 이렇게 나뉜다」가 한눈에 보이게 한다. 색은 currentColor(고른 배치는 강조색)
 */
export function SplitLayoutPreview({ layout }: { readonly layout: PdfSplitLayout }) {
  const width = 44
  const height = 30
  const pad = 2
  const gap = 2.2
  const colWidth = (width - pad * 2 - gap * (layout.cols - 1)) / layout.cols
  const rowHeight = (height - pad * 2 - gap * (layout.rows - 1)) / layout.rows
  return (
    <svg className="split-preview" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect x="0.6" y="0.6" width={width - 1.2} height={height - 1.2} rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      {layout.cells.map((cell, index) => {
        const x = pad + cell.col * (colWidth + gap)
        const y = pad + cell.row * (rowHeight + gap)
        const w = colWidth * cell.colSpan + gap * (cell.colSpan - 1)
        const h = rowHeight * cell.rowSpan + gap * (cell.rowSpan - 1)
        return (
          <g key={index}>
            <rect x={x} y={y} width={w} height={h} rx="2.4" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1" />
            <line x1={x + 3} y1={y + 3.6} x2={x + Math.min(w - 3, 3 + w * 0.45)} y2={y + 3.6} stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        )
      })}
    </svg>
  )
}

/** 화면 나누기 배치 그림(도구줄 단추용 작은 그림): 칸마다 네모 하나 */
export function SplitLayoutIcon({ layout, size = 16 }: { readonly layout: PdfSplitLayout; readonly size?: number }) {
  const pad = 1.5
  const gap = 1.6
  const inner = 16 - pad * 2
  const colWidth = (inner - gap * (layout.cols - 1)) / layout.cols
  const rowHeight = (inner - gap * (layout.rows - 1)) / layout.rows
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      {layout.cells.map((cell, index) => (
        <rect
          key={index}
          x={pad + cell.col * (colWidth + gap)}
          y={pad + cell.row * (rowHeight + gap)}
          width={colWidth * cell.colSpan + gap * (cell.colSpan - 1)}
          height={rowHeight * cell.rowSpan + gap * (cell.rowSpan - 1)}
          rx="1.2"
        />
      ))}
    </svg>
  )
}

/** PDF 위 줄의 쪽 배치(한 장·두 장·세 장·연속) 단추 */
export function PdfPageLayoutButtons({ layout, onChange, buttonClassName, clean, onCleanChange, onlyOpenNotes, onOnlyOpenNotesChange }: {
  readonly layout: PdfPageLayout
  readonly onChange: (layout: PdfPageLayout) => void
  readonly buttonClassName: string
  /** 깨끗이 보기(내 표시 모두 감추기). 주면 맨 앞에 눈 단추가 나온다 */
  readonly clean?: boolean
  readonly onCleanChange?: (clean: boolean) => void
  /** 열린 노트 표시만 보기. 주면 눈 단추 바로 옆에 깔때기 단추가 나온다 */
  readonly onlyOpenNotes?: boolean
  readonly onOnlyOpenNotesChange?: (on: boolean) => void
}) {
  const button = (label: string, pressed: boolean, next: PdfPageLayout, icon: ReactNode, title = label) => (
    <button
      type="button"
      className={`${buttonClassName}${pressed ? ' toolbar-tool-btn-active' : ''}`}
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      onClick={() => onChange(next)}
    >
      {icon}
    </button>
  )
  return (
    <div className="pdf-page-layout-tools" role="group" aria-label={t('쪽 배치')}>
      {onCleanChange === undefined ? null : (
        <>
          <CleanViewButton clean={clean === true} onChange={onCleanChange} buttonClassName={buttonClassName} />
          {onOnlyOpenNotesChange === undefined ? null : <OnlyOpenNotesButton on={onlyOpenNotes === true} onChange={onOnlyOpenNotesChange} buttonClassName={buttonClassName} />}
          <span className="pane-toolbar-divider" aria-hidden="true" />
        </>
      )}
      {button(t('한 장 보기'), layout.spread === 'single', { ...layout, spread: 'single' }, <File size={15} aria-hidden="true" />)}
      {button(t('두 장 보기'), layout.spread === 'double', { ...layout, spread: 'double' }, <BookOpen size={15} aria-hidden="true" />)}
      {button(t('세 장 보기'), layout.spread === 'triple', { ...layout, spread: 'triple' }, <ThreePagesIcon size={15} />)}
      <span className="pane-toolbar-divider" aria-hidden="true" />
      {button(t('연속 보기'), layout.continuous, { ...layout, continuous: !layout.continuous }, <Rows size={15} aria-hidden="true" />,
        t('연속 보기'))}
    </div>
  )
}

/** 화면 나누기 단추. 누르면 배치 그림 목록이 펼쳐진다 */
export function PdfSplitPicker({
  value, onChange, buttonClassName, layouts = PDF_SPLIT_LAYOUTS, label = t('화면 나누기'), head = t('화면 나누기: 같은 PDF의 다른 쪽을 함께 봅니다'), align = 'right', activeClassName = 'toolbar-tool-btn-active', shortcut, presets,
}: {
  /** 지금 배치. 예전 배치 중 어느 것과도 모양이 다르면(직접 나눈 칸) null */
  readonly value: PdfSplitLayoutId | null
  readonly onChange: (id: PdfSplitLayoutId) => void
  readonly buttonClassName: string
  /** 고를 수 있는 배치(앱 창 나누기는 좌우 배치만) */
  readonly layouts?: readonly PdfSplitLayout[]
  readonly label?: string
  readonly head?: string
  /** 목록을 단추 오른쪽 끝에 맞출지(도구줄), 왼쪽 끝에 맞출지(상단바 왼쪽) */
  readonly align?: 'left' | 'right'
  readonly activeClassName?: string
  readonly shortcut?: string
  /** 이름 붙은 배치(읽기·노트 왼쪽 …). 주면 배치 그림 아래에 「배치」 목록이 나온다 */
  readonly presets?: { readonly presets: readonly LayoutPresetDef[]; readonly onApply: (id: LayoutPresetId) => void }
}) {
  // 펼친 목록은 창 맨 위 층에 띄운다(PDF 화면이 도구줄보다 위 층이라 그 안에 두면 가려진다)
  const [open, setOpen] = useState<{ readonly top: number; readonly right?: number; readonly left?: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open === null) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target))) return
      setOpen(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])
  const current = value === null ? null : pdfSplitLayout(value)
  const split = value !== 'single'
  return (
    <div className="pdf-split-picker" ref={rootRef}>
      <button
        type="button"
        className={`${buttonClassName}${split ? ` ${activeClassName}` : ''}`}
        aria-label={label}
        title={`${t('{label} (지금: {current})', { label, current: current === null ? t('직접 나눈 배치') : current.label })}${shortcut === undefined ? '' : ` ${shortcut}`}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setOpen((shown) => (shown !== null ? null : align === 'left'
            ? { top: rect.bottom + 6, left: Math.max(rect.left, 8) }
            : { top: rect.bottom + 6, right: Math.max(window.innerWidth - rect.right, 8) }))
        }}
      >
        <SplitLayoutIcon layout={split && current !== null ? current : pdfSplitLayout('cols2')} size={15} />
      </button>
      {open !== null ? createPortal(
        <div ref={menuRef} className="pdf-split-menu" role="menu" aria-label={label} style={{ top: open.top, ...(open.right === undefined ? { left: open.left } : { right: open.right }) }}>
          <div className="pdf-split-menu-head">{head}</div>
          <div className="pdf-split-menu-grid">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                type="button"
                role="menuitemradio"
                aria-checked={layout.id === value}
                className={`pdf-split-menu-item${layout.id === value ? ' pdf-split-menu-item-active' : ''}`}
                title={layout.label}
                onClick={() => {
                  onChange(layout.id)
                  setOpen(null)
                }}
              >
                <SplitLayoutPreview layout={layout} />
                <span>{layout.label}</span>
              </button>
            ))}
          </div>
          {presets === undefined || presets.presets.length === 0 ? null : (
            <div className="pdf-split-presets" role="group" aria-label={t('배치')}>
              <div className="pdf-split-menu-head">{t('배치: 열린 탭을 이 모양으로 다시 놓습니다')}</div>
              {presets.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitem"
                  className="pdf-split-preset"
                  onClick={() => {
                    presets.onApply(preset.id)
                    setOpen(null)
                  }}
                >
                  <span className="pdf-split-preset-name">{preset.label}</span>
                  <span className="pdf-split-preset-hint">{preset.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

/** 깨끗이 보기(눈 단추): 내가 단 표시(형광펜·메모·책갈피)를 모두 감춘다. PDF·Markdown 이 같이 쓴다 */
export function CleanViewButton({ clean, onChange, buttonClassName }: { readonly clean: boolean; readonly onChange: (clean: boolean) => void; readonly buttonClassName: string }) {
  return (
    <button
      type="button"
      className={`${buttonClassName}${clean ? ' toolbar-tool-btn-active' : ''}`}
      aria-label={clean ? t('표시 다시 보이기') : t('표시 모두 숨기기')}
      title={clean ? t('표시 다시 보이기') : t('표시 모두 숨기기 (형광펜, 메모, 책갈피)')}
      aria-pressed={clean}
      onClick={() => onChange(!clean)}
    >
      {clean ? <EyeSlash size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
    </button>
  )
}

/** 열린 노트 표시만 보기(깔때기 단추): 열린 노트의 형광펜·메모만 PDF 에 둔다. 보기만 거르며 데이터는 그대로 */
export function OnlyOpenNotesButton({ on, onChange, buttonClassName }: { readonly on: boolean; readonly onChange: (on: boolean) => void; readonly buttonClassName: string }) {
  return (
    <button
      type="button"
      className={`${buttonClassName} pdf-only-open-notes${on ? ' toolbar-tool-btn-active' : ''}`}
      aria-label={t('열린 노트 표시만 보기')}
      title={t('켜면 같은 색 칸에 열린 노트의 형광펜과 메모만 PDF에 보입니다')}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <Funnel size={15} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
    </button>
  )
}
