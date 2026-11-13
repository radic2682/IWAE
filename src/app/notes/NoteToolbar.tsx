import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOutSimple,
  Export,
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  CaretDown,
  Check,
  Code,
  GearSix,
  Highlighter,
  Image,
  ListBullets,
  ListNumbers,
  PaintBucket,
  Minus,
  Square,
  TextT,
  TextAUnderline,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BlockFormatCommand } from '../../core/blockFormatting'
import { textBlockLevelFontSize } from '../../core/canvasDocument'
import type {
  CanvasBlockPreset,
  CanvasEdgeMarker,
  TextBlockLevel,
  TextBlockStyle,
} from '../../core/canvasDocument'
import type { UserBlockPreset } from '../../core/blockPresets'
import { scrollHorizontalStrip } from '../horizontalScroll'
import { useExclusivePopover } from '../useExclusivePopover'
import { t } from '../../i18n'

interface NoteToolbarProps {
  readonly selectionStyle: TextBlockStyle | null
  readonly canFormat: boolean
  readonly canStyleBlock?: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onCommand: (command: BlockFormatCommand) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly connectionStartMarker: CanvasEdgeMarker
  readonly connectionEndMarker: CanvasEdgeMarker
  readonly selectedEdgeCount: number
  readonly selectedBlockEdgeCount?: number
  readonly matchPdfTextSize?: boolean
  readonly onMatchPdfTextSizeChange?: (enabled: boolean) => void
  readonly onSetConnectionStartMarker: (marker: CanvasEdgeMarker) => void
  readonly onSetConnectionEndMarker: (marker: CanvasEdgeMarker) => void
  readonly onDeleteSelectedEdges: () => void
  readonly onAddPreset: (preset: CanvasBlockPreset) => void
  readonly onAddImage?: () => void
  readonly onSetConnectionMode?: (start: CanvasEdgeMarker, end: CanvasEdgeMarker) => void
  readonly activeDrawingTool?: CanvasBlockPreset | null
  /** 형광펜 도구(발췌 위를 끌어 칠한다) */
  readonly highlightToolActive?: boolean
  readonly onToggleHighlightTool?: () => void
  readonly userPresets?: readonly UserBlockPreset[]
  readonly onAddUserPreset?: (presetId: string) => void
  readonly onSetBlockBackground: (color: string) => void
  readonly onSetBlockBorderColor: (color: string) => void
  readonly onSetBlockBorderWidth?: (width: number) => void
  readonly onToggleFullscreen: () => void
  /** 노트와 인용한 근거를 HTML 한 파일로 내보낸다 */
  readonly onExportWithEvidence?: () => void
}

const TEXT_COLORS = [
  ['검정', '#1f2328'], ['회색', '#59636e'], ['갈색', '#7c4a2d'], ['빨강', '#b42318'], ['주황', '#b54708'], ['초록', '#067647'], ['파랑', '#1d4ed8'],
  ['연한 검정', '#454c54'], ['연한 회색', '#89929c'], ['연한 갈색', '#a15c38'], ['연한 빨강', '#d92d20'], ['연한 주황', '#e04f16'], ['연한 초록', '#099250'], ['연한 파랑', '#3b82f6'],
  ['진한 검정', '#111418'], ['진한 회색', '#343a40'], ['진한 갈색', '#5d3624'], ['진한 빨강', '#912018'], ['진한 주황', '#93370d'], ['진한 초록', '#05603a'], ['보라', '#6938ef'],
] as const

const HIGHLIGHT_COLORS = [
  ['노랑', '#fff2a8'], ['라임', '#d8f999'], ['민트', '#a6f4c5'], ['하늘', '#b9e6fe'], ['파랑', '#c7d7fe'], ['보라', '#ddd6fe'], ['분홍', '#fbcfe8'],
  ['진한 노랑', '#fde272'], ['진한 라임', '#bef264'], ['진한 민트', '#6ce9a6'], ['진한 하늘', '#7cd4fd'], ['진한 파랑', '#a4bcfd'], ['진한 보라', '#c3b5fd'], ['진한 분홍', '#f9a8d4'],
  ['옅은 노랑', '#fffaeb'], ['옅은 라임', '#f2fce7'], ['옅은 민트', '#ecfdf3'], ['옅은 하늘', '#f0f9ff'], ['옅은 파랑', '#eef4ff'], ['옅은 보라', '#f4f3ff'], ['옅은 분홍', '#fdf2fa'],
] as const

const BLOCK_COLORS = [
  ['흰색', '#ffffff'], ['노랑', '#fff2a8'], ['민트', '#d1fae5'], ['하늘', '#e0f2fe'], ['보라', '#ede9fe'], ['분홍', '#fce7f3'], ['회색', '#f3f4f6'],
] as const

const BORDER_COLORS = [
  ['회색', '#c9ced6'], ['검정', '#1f2328'], ['빨강', '#b42318'], ['주황', '#b54708'], ['초록', '#067647'], ['파랑', '#1d4ed8'], ['보라', '#6938ef'],
] as const

const COLOR_POPOVER_WIDTH = 244
const COLOR_POPOVER_GUTTER = 8

interface ColorSwatchPickerProps {
  readonly popoverId: string
  readonly open: boolean
  readonly label: string
  readonly value: string
  readonly colors: readonly (readonly [string, string])[]
  readonly disabled: boolean
  readonly icon: 'text' | 'highlight' | 'background' | 'border'
  readonly onSelect: (color: string) => void
  readonly onClear: () => void
  readonly onToggle: () => void
  readonly onClose: () => void
}

interface ToolbarSelectOption<T extends string | number> {
  readonly value: T
  readonly label: string
  /** 목록에서 이름 옆(오른쪽)에 보이는 미리보기 */
  readonly preview?: ReactNode
}

/**
 * 도구줄의 드롭다운. 운영체제 기본 select 대신 색 팔레트와 같은 모양의 목록을 띄운다.
 * 위아래 화살표로 고르고 Enter 로 정한다. Esc·바깥 누르기로 닫힌다(useExclusivePopover).
 */
function ToolbarSelect<T extends string | number>({ popoverId, open, label, value, placeholder, options, disabled, className, onSelect, onToggle, onClose }: {
  readonly popoverId: string
  readonly open: boolean
  readonly label: string
  readonly value: T | undefined
  readonly placeholder?: string
  readonly options: readonly ToolbarSelectOption<T>[]
  readonly disabled?: boolean
  readonly className?: string
  readonly onSelect: (value: T) => void
  readonly onToggle: () => void
  readonly onClose: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)
  const rect = triggerRef.current?.getBoundingClientRect()

  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const selected = list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLButtonElement>('[role="option"]')
    selected?.focus()
  }, [open])

  const moveFocus = (step: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    const index = items.findIndex((item) => item === document.activeElement)
    items[(index + step + items.length) % items.length]?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={['note-select-trigger', className ?? ''].filter(Boolean).join(' ')}
        data-exclusive-popover={popoverId}
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            onToggle()
          }
        }}
      >
        <span className={current === undefined ? 'note-select-value note-select-placeholder' : 'note-select-value'}>{current === undefined ? placeholder ?? '' : t(current.label)}</span>
        <CaretDown size={11} weight="bold" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          className="note-select-menu"
          data-exclusive-popover={popoverId}
          role="listbox"
          aria-label={label}
          style={{
            left: Math.max(COLOR_POPOVER_GUTTER, Math.min(rect?.left ?? COLOR_POPOVER_GUTTER, window.innerWidth - 220 - COLOR_POPOVER_GUTTER)),
            top: (rect?.bottom ?? 0) + 5,
            minWidth: Math.max(rect?.width ?? 0, 120),
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveFocus(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveFocus(-1)
            } else if (event.key === 'Tab') {
              onClose()
            }
          }}
        >
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="note-select-option"
              onClick={() => {
                onSelect(option.value)
                onClose()
                triggerRef.current?.focus()
              }}
            >
              <span className="note-select-check" aria-hidden="true">{option.value === value ? <Check size={12} weight="bold" /> : null}</span>
              <span className="note-select-label">{t(option.label)}</span>
              {option.preview === undefined ? null : <span className="note-select-preview" aria-hidden="true">{option.preview}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

const LEVEL_OPTIONS: readonly ToolbarSelectOption<TextBlockLevel>[] = ([
  { value: 'paragraph', label: '본문' },
  { value: 'h1', label: '제목 1' },
  { value: 'h2', label: '제목 2' },
  { value: 'h3', label: '제목 3' },
  { value: 'h4', label: '제목 4' },
  { value: 'h5', label: '제목 5' },
  { value: 'h6', label: '제목 6' },
] as const satisfies readonly { value: TextBlockLevel; label: string }[]).map((option) => ({
  ...option,
  preview: <span className="note-select-size">{textBlockLevelFontSize(option.value)}</span>,
}))

function ColorSwatchPicker({ popoverId, open, label, value, colors, disabled, icon, onSelect, onClear, onToggle, onClose }: ColorSwatchPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const triggerRect = triggerRef.current?.getBoundingClientRect()
  const popoverLeft = Math.max(
    COLOR_POPOVER_GUTTER,
    Math.min(
      triggerRect?.left ?? COLOR_POPOVER_GUTTER,
      window.innerWidth - COLOR_POPOVER_WIDTH - COLOR_POPOVER_GUTTER,
    ),
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="note-color-trigger"
        data-exclusive-popover={popoverId}
        aria-label={t('{label} 선택', { label })}
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        {icon === 'text' ? <TextAUnderline size={18} aria-hidden="true" /> : null}
        {icon === 'highlight' ? <Highlighter size={18} aria-hidden="true" /> : null}
        {icon === 'background' ? <PaintBucket size={18} aria-hidden="true" /> : null}
        {icon === 'border' ? <Square size={18} aria-hidden="true" /> : null}
        <span className="note-color-current" style={{ backgroundColor: value }} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          className="note-color-popover"
          data-exclusive-popover={popoverId}
          role="dialog"
          aria-label={t('{label} 팔레트', { label })}
          style={{ left: popoverLeft, top: (triggerRect?.bottom ?? 0) + 5 }}
        >
          <div className="note-color-swatches">
            {colors.map(([name, color]) => (
              <button
                key={color}
                type="button"
                aria-label={`${label} ${t(name)}`}
                aria-pressed={value.toLowerCase() === color.toLowerCase()}
                className="note-color-swatch"
                style={{ backgroundColor: color }}
                onClick={() => {
                  onSelect(color)
                  onClose()
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className="note-color-clear"
            onClick={() => {
              onClear()
              onClose()
            }}
          >
            {icon === 'text' ? t('기본 글자색') : null}
            {icon === 'highlight' ? t('강조 없음') : null}
            {icon === 'background' ? t('블록 배경 없음') : null}
            {icon === 'border' ? t('기본 테두리색') : null}
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

function NoteOptions({ open, onToggle, matchPdfTextSize, onMatchPdfTextSizeChange }: { open: boolean; onToggle: () => void; matchPdfTextSize: boolean; onMatchPdfTextSizeChange: (enabled: boolean) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const triggerRect = triggerRef.current?.getBoundingClientRect()

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="note-toolbar-options-trigger"
      data-exclusive-popover="note-options"
      aria-label={t('노트 옵션')}
      aria-expanded={open}
      onClick={onToggle}
    >
      <GearSix size={17} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div
        className="note-options-popover"
        data-exclusive-popover="note-options"
        role="dialog"
        aria-label={t('노트 옵션')}
        style={{ right: Math.max(8, window.innerWidth - (triggerRect?.right ?? window.innerWidth)), top: (triggerRect?.bottom ?? 0) + 7 }}
      >
        <label className="note-options-setting">
          <span>
            <strong>{t('PDF 글자 크기 맞춤')}</strong>
            <small>{t('선택한 글자 높이에 맞춰 발췌 블록을 붙입니다.')}</small>
          </span>
          <input type="checkbox" checked={matchPdfTextSize} onChange={(event) => onMatchPdfTextSizeChange(event.target.checked)} />
        </label>
      </div>,
      document.body,
    )}
  </>
}

/** 테두리 두께 선택지(px). 0 = 테두리 없음. 목록에 실제 두께의 선을 보인다 */
const BORDER_WIDTH_OPTIONS: readonly ToolbarSelectOption<number>[] = [0, 1, 2, 3, 4, 6, 8].map((width) => ({
  value: width,
  label: width === 0 ? '없음' : `${width}px`,
  preview: <span className="note-select-line" style={{ height: Math.max(width, 0), opacity: width === 0 ? 0 : 1 }} />,
}))

export function NoteToolbar({
  selectionStyle,
  canFormat,
  canStyleBlock = canFormat,
  canUndo,
  canRedo,
  connectionStartMarker,
  connectionEndMarker,
  matchPdfTextSize = true,
  onMatchPdfTextSizeChange = () => undefined,
  onCommand,
  onUndo,
  onRedo,
  onSetConnectionMode,
  onAddPreset,
  onAddImage,
  activeDrawingTool,
  highlightToolActive = false,
  onToggleHighlightTool,
  onSetBlockBackground,
  onSetBlockBorderColor,
  onSetBlockBorderWidth,
  onToggleFullscreen,
  onExportWithEvidence,
}: NoteToolbarProps) {
  const style = selectionStyle
  const popover = useExclusivePopover()
  return (
    <div className="note-toolbar" role="toolbar" aria-label={t('노트 편집 도구')}>
      <div className="note-toolbar-primary">
      <div className="note-toolbar-controls" onWheel={scrollHorizontalStrip}>
      <button type="button" aria-label={t('실행 취소')} disabled={!canUndo} onClick={onUndo}><ArrowCounterClockwise size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('다시 실행')} disabled={!canRedo} onClick={onRedo}><ArrowClockwise size={17} aria-hidden="true" /></button>
      <span className="note-toolbar-divider" />
      <ToolbarSelect
        popoverId="block-level"
        open={popover.openId === 'block-level'}
        label={t('블록 유형')}
        className="note-select-level"
        value={style?.level ?? 'paragraph'}
        options={LEVEL_OPTIONS}
        disabled={!canFormat}
        onSelect={(level) => onCommand({ type: 'setLevel', level })}
        onToggle={() => popover.toggle('block-level')}
        onClose={popover.close}
      />
      <input
        className="note-font-size"
        aria-label={t('글자 크기')}
        type="number"
        min={8}
        max={96}
        value={style?.fontSize ?? 16}
        disabled={!canFormat}
        onChange={(event) => onCommand({ type: 'setFontSize', fontSize: Number(event.target.value) })}
      />
      <span className="note-toolbar-divider" />
      <button type="button" aria-label={t('굵게')} aria-pressed={style?.bold ?? false} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleBold' })}><TextB size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('기울임')} aria-pressed={style?.italic ?? false} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleItalic' })}><TextItalic size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('밑줄')} aria-pressed={style?.underline ?? false} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleUnderline' })}><TextUnderline size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('취소선')} aria-pressed={style?.strike ?? false} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleStrike' })}><TextStrikethrough size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('인라인 코드')} aria-pressed={style?.code ?? false} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleCode' })}><Code size={17} aria-hidden="true" /></button>
      <span className="note-toolbar-divider" />
      <button type="button" aria-label={t('왼쪽 정렬')} aria-pressed={style?.align === 'left'} disabled={!canFormat} onClick={() => onCommand({ type: 'setAlign', align: 'left' })}><TextAlignLeft size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('가운데 정렬')} aria-pressed={style?.align === 'center'} disabled={!canFormat} onClick={() => onCommand({ type: 'setAlign', align: 'center' })}><TextAlignCenter size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('오른쪽 정렬')} aria-pressed={style?.align === 'right'} disabled={!canFormat} onClick={() => onCommand({ type: 'setAlign', align: 'right' })}><TextAlignRight size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('글머리 목록')} aria-pressed={style?.list === 'bullet'} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleList', list: 'bullet' })}><ListBullets size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('번호 목록')} aria-pressed={style?.list === 'number'} disabled={!canFormat} onClick={() => onCommand({ type: 'toggleList', list: 'number' })}><ListNumbers size={17} aria-hidden="true" /></button>
      <ColorSwatchPicker
        popoverId="text-color"
        open={popover.openId === 'text-color'}
        label={t('글자색')}
        value={style?.color ?? '#1f2328'}
        colors={TEXT_COLORS}
        disabled={!canFormat}
        icon="text"
        onSelect={(color) => onCommand({ type: 'setColor', color })}
        onClear={() => onCommand({ type: 'setColor', color: '#1f2328' })}
        onToggle={() => popover.toggle('text-color')}
        onClose={popover.close}
      />
      <ColorSwatchPicker
        popoverId="text-highlight"
        open={popover.openId === 'text-highlight'}
        label={t('강조색')}
        value={style?.highlight ?? 'transparent'}
        colors={HIGHLIGHT_COLORS}
        disabled={!canFormat}
        icon="highlight"
        onSelect={(highlight) => onCommand({ type: 'setHighlight', highlight })}
        onClear={() => onCommand({ type: 'setHighlight', highlight: 'transparent' })}
        onToggle={() => popover.toggle('text-highlight')}
        onClose={popover.close}
      />
      <ColorSwatchPicker
        popoverId="block-background"
        open={popover.openId === 'block-background'}
        label={t('블록 배경색')}
        value={style?.background ?? 'transparent'}
        colors={BLOCK_COLORS}
        disabled={!canStyleBlock}
        icon="background"
        onSelect={onSetBlockBackground}
        onClear={() => onSetBlockBackground('transparent')}
        onToggle={() => popover.toggle('block-background')}
        onClose={popover.close}
      />
      </div>
      {onExportWithEvidence !== undefined ? (
        <button className="note-toolbar-fullscreen note-toolbar-export" type="button" aria-label={t('근거와 함께 내보내기')} title={t('근거와 함께 내보내기')} onClick={onExportWithEvidence}><Export size={17} aria-hidden="true" /></button>
      ) : null}
      <button className="note-toolbar-fullscreen" type="button" aria-label={t('노트 전체 화면')} onClick={onToggleFullscreen}><ArrowsOutSimple size={17} aria-hidden="true" /></button>
      </div>
      <div className="note-toolbar-secondary">
      <div className="note-toolbar-secondary-controls" onWheel={scrollHorizontalStrip}>
      <ColorSwatchPicker
        popoverId="block-border"
        open={popover.openId === 'block-border'}
        label={t('블록 테두리색')}
        value={style?.borderColor ?? '#c9ced6'}
        colors={BORDER_COLORS}
        disabled={!canStyleBlock}
        icon="border"
        onSelect={onSetBlockBorderColor}
        onClear={() => onSetBlockBorderColor('#c9ced6')}
        onToggle={() => popover.toggle('block-border')}
        onClose={popover.close}
      />
      {onSetBlockBorderWidth !== undefined ? (
        <ToolbarSelect
          popoverId="block-border-width"
          open={popover.openId === 'block-border-width'}
          label={t('테두리 두께')}
          className="note-select-border-width"
          value={style?.borderWidth}
          placeholder={t('두께')}
          options={BORDER_WIDTH_OPTIONS}
          disabled={!canStyleBlock}
          onSelect={onSetBlockBorderWidth}
          onToggle={() => popover.toggle('block-border-width')}
          onClose={popover.close}
        />
      ) : null}
      <span className="note-toolbar-divider" />
      <button type="button" aria-label={t('텍스트 블록 추가')} title={t('텍스트 블록 추가')} onClick={() => onAddPreset('paragraph')}><TextT size={18} aria-hidden="true" /></button>
      <button type="button" aria-label={t('네모 그리기')} title={t('네모 그리기')} aria-pressed={activeDrawingTool === 'rectangle'} onClick={() => onAddPreset('rectangle')}><Square size={18} aria-hidden="true" /></button>
      {onToggleHighlightTool === undefined ? null : (
        <button type="button" aria-label={t('발췌 형광펜')} title={t('발췌 형광펜')} aria-pressed={highlightToolActive} onClick={onToggleHighlightTool}>
          <Highlighter size={18} aria-hidden="true" />
        </button>
      )}
      <button type="button" aria-label={t('이미지 추가')} title={t('이미지 추가')} onClick={onAddImage}><Image size={18} aria-hidden="true" /></button>
      <span className="note-toolbar-divider" />
      <div className="note-line-modes" role="group" aria-label={t('연결선 종류')}>
        {([
          { label: '일반선', start: 'none', end: 'none', icon: <Minus size={18} aria-hidden="true" /> },
          { label: '왼쪽 화살표', start: 'arrow', end: 'none', icon: <ArrowLeft size={18} aria-hidden="true" /> },
          { label: '오른쪽 화살표', start: 'none', end: 'arrow', icon: <ArrowRight size={18} aria-hidden="true" /> },
          { label: '양방향 화살표', start: 'arrow', end: 'arrow', icon: <ArrowsLeftRight size={18} aria-hidden="true" /> },
        ] as const).map(({ label, start, end, icon }) => (
          <button key={label} type="button" aria-label={t(label)} title={t(label)}
            aria-pressed={connectionStartMarker === start && connectionEndMarker === end}
            onClick={() => onSetConnectionMode?.(start, end)}>{icon}</button>
        ))}
      </div>
      </div>
      <NoteOptions
        open={popover.openId === 'note-options'}
        onToggle={() => popover.toggle('note-options')}
        matchPdfTextSize={matchPdfTextSize}
        onMatchPdfTextSizeChange={onMatchPdfTextSizeChange}
      />
      </div>
    </div>
  )
}
