import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOutSimple,
  Export,
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  GearSix,
  Highlighter,
  Image,
  PaintBucket,
  Minus,
  Square,
  TextT,
} from '@phosphor-icons/react'
import { useRef } from 'react'
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
import { FormatBar, FormatColorButton, type FormatSwatch } from '../../ui/format/FormatBar'
import { Select, type SelectOption } from '../../ui/Select'
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

const swatches = (pairs: readonly (readonly [string, string])[]): readonly FormatSwatch[] => pairs.map(([name, value]) => ({ name, value }))

const TEXT_COLORS = swatches([
  ['검정', '#1f2328'], ['회색', '#59636e'], ['갈색', '#7c4a2d'], ['빨강', '#b42318'], ['주황', '#b54708'], ['초록', '#067647'], ['파랑', '#1d4ed8'],
  ['연한 검정', '#454c54'], ['연한 회색', '#89929c'], ['연한 갈색', '#a15c38'], ['연한 빨강', '#d92d20'], ['연한 주황', '#e04f16'], ['연한 초록', '#099250'], ['연한 파랑', '#3b82f6'],
  ['진한 검정', '#111418'], ['진한 회색', '#343a40'], ['진한 갈색', '#5d3624'], ['진한 빨강', '#912018'], ['진한 주황', '#93370d'], ['진한 초록', '#05603a'], ['보라', '#6938ef'],
])

const HIGHLIGHT_COLORS = swatches([
  ['노랑', '#fff2a8'], ['라임', '#d8f999'], ['민트', '#a6f4c5'], ['하늘', '#b9e6fe'], ['파랑', '#c7d7fe'], ['보라', '#ddd6fe'], ['분홍', '#fbcfe8'],
  ['진한 노랑', '#fde272'], ['진한 라임', '#bef264'], ['진한 민트', '#6ce9a6'], ['진한 하늘', '#7cd4fd'], ['진한 파랑', '#a4bcfd'], ['진한 보라', '#c3b5fd'], ['진한 분홍', '#f9a8d4'],
  ['옅은 노랑', '#fffaeb'], ['옅은 라임', '#f2fce7'], ['옅은 민트', '#ecfdf3'], ['옅은 하늘', '#f0f9ff'], ['옅은 파랑', '#eef4ff'], ['옅은 보라', '#f4f3ff'], ['옅은 분홍', '#fdf2fa'],
])

const BLOCK_COLORS = swatches([
  ['흰색', '#ffffff'], ['노랑', '#fff2a8'], ['민트', '#d1fae5'], ['하늘', '#e0f2fe'], ['보라', '#ede9fe'], ['분홍', '#fce7f3'], ['회색', '#f3f4f6'],
])

const BORDER_COLORS = swatches([
  ['회색', '#c9ced6'], ['검정', '#1f2328'], ['빨강', '#b42318'], ['주황', '#b54708'], ['초록', '#067647'], ['파랑', '#1d4ed8'], ['보라', '#6938ef'],
])

const LEVELS: readonly { value: TextBlockLevel; label: string }[] = [
  { value: 'paragraph', label: '본문' },
  { value: 'h1', label: '제목 1' },
  { value: 'h2', label: '제목 2' },
  { value: 'h3', label: '제목 3' },
  { value: 'h4', label: '제목 4' },
  { value: 'h5', label: '제목 5' },
  { value: 'h6', label: '제목 6' },
]

/** 캔버스 글 블록의 글자 크기(px): 범위와 자주 쓰는 크기 */
const CANVAS_SIZE_MIN = 8
const CANVAS_SIZE_MAX = 96
const CANVAS_SIZES: readonly number[] = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 96]

/** 테두리 두께 선택지(px). 0 = 테두리 없음. 목록에 실제 두께의 선을 보인다 */
const BORDER_WIDTHS: readonly number[] = [0, 1, 2, 3, 4, 6, 8]

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

/**
 * 캔버스 도구줄(두 줄). 첫 줄의 글 서식은 노트 · 글 상자와 같은 서식 줄(FormatBar)이다: 문단 모양 · 크기 · 글자 모양 · 정렬 · 목록 · 색,
 * 덧붙인 묶음으로 블록 배경색. 명령은 고른 글 블록 전체에 걸린다(BlockFormatCommand). 둘째 줄은 블록 테두리 · 블록 넣기 · 연결선 · 옵션.
 */
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
  const levelOptions: readonly SelectOption[] = LEVELS.map((level) => ({
    value: level.value,
    label: t(level.label),
    hint: textBlockLevelFontSize(level.value),
  }))
  const borderWidthOptions: readonly SelectOption[] = BORDER_WIDTHS.map((width) => ({
    value: String(width),
    label: width === 0 ? t('없음') : `${width}px`,
    hint: <span className="note-select-line" style={{ height: Math.max(width, 0), opacity: width === 0 ? 0 : 1 }} />,
  }))
  return (
    <div className="note-toolbar" role="toolbar" aria-label={t('노트 편집 도구')}>
      <div className="note-toolbar-primary">
      <div className="note-toolbar-controls" data-format-fold-host="" onWheel={scrollHorizontalStrip}>
      <button type="button" aria-label={t('실행 취소')} disabled={!canUndo} onClick={onUndo}><ArrowCounterClockwise size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('다시 실행')} disabled={!canRedo} onClick={onRedo}><ArrowClockwise size={17} aria-hidden="true" /></button>
      <span className="note-toolbar-divider" />
      <FormatBar
        label={t('글 블록 서식')}
        className="canvas-format-bar"
        disabled={!canFormat}
        block={{ value: style?.level ?? 'paragraph', options: levelOptions, onChange: (level) => onCommand({ type: 'setLevel', level: level as TextBlockLevel }) }}
        fontSize={{
          value: style?.fontSize ?? 16,
          onChange: (fontSize) => onCommand({ type: 'setFontSize', fontSize }),
          min: CANVAS_SIZE_MIN,
          max: CANVAS_SIZE_MAX,
          step: 1,
          unit: 'px',
          presets: CANVAS_SIZES,
          title: t('글자 크기 (px), ↑↓로 1씩'),
        }}
        marks={{
          bold: { active: style?.bold ?? false, onToggle: () => onCommand({ type: 'toggleBold' }) },
          italic: { active: style?.italic ?? false, onToggle: () => onCommand({ type: 'toggleItalic' }) },
          underline: { active: style?.underline ?? false, onToggle: () => onCommand({ type: 'toggleUnderline' }) },
          strike: { active: style?.strike ?? false, onToggle: () => onCommand({ type: 'toggleStrike' }) },
          code: { active: style?.code ?? false, onToggle: () => onCommand({ type: 'toggleCode' }) },
        }}
        align={{ value: style?.align ?? null, onChange: (align) => onCommand({ type: 'setAlign', align }) }}
        lists={{
          bullet: { active: style?.list === 'bullet', onToggle: () => onCommand({ type: 'toggleList', list: 'bullet' }) },
          number: { active: style?.list === 'number', onToggle: () => onCommand({ type: 'toggleList', list: 'number' }) },
        }}
        textColor={{
          value: style?.color ?? '#1f2328',
          colors: TEXT_COLORS,
          onChange: (color) => onCommand({ type: 'setColor', color }),
          clear: { label: t('기본 글자색'), onClear: () => onCommand({ type: 'setColor', color: '#1f2328' }) },
        }}
        highlight={{
          value: style?.highlight ?? 'transparent',
          colors: HIGHLIGHT_COLORS,
          onChange: (highlight) => onCommand({ type: 'setHighlight', highlight }),
          clear: { label: t('글자 배경 없음'), onClear: () => onCommand({ type: 'setHighlight', highlight: 'transparent' }) },
        }}
        shortcuts={{ bold: 'Ctrl+B', italic: 'Ctrl+I', underline: 'Ctrl+U' }}
        extras={[{
          key: 'block-background',
          node: (
            <FormatColorButton
              label={t('블록 배경색')}
              icon={<PaintBucket size={16} aria-hidden="true" />}
              disabled={!canStyleBlock}
              config={{
                value: style?.background ?? 'transparent',
                colors: BLOCK_COLORS,
                onChange: onSetBlockBackground,
                clear: { label: t('블록 배경 없음'), onClear: () => onSetBlockBackground('transparent') },
              }}
            />
          ),
        }]}
      />
      </div>
      {onExportWithEvidence !== undefined ? (
        <button className="note-toolbar-fullscreen note-toolbar-export" type="button" aria-label={t('근거와 함께 내보내기')} title={t('근거와 함께 내보내기')} onClick={onExportWithEvidence}><Export size={17} aria-hidden="true" /></button>
      ) : null}
      <button className="note-toolbar-fullscreen" type="button" aria-label={t('노트 전체 화면')} onClick={onToggleFullscreen}><ArrowsOutSimple size={17} aria-hidden="true" /></button>
      </div>
      <div className="note-toolbar-secondary">
      <div className="note-toolbar-secondary-controls" onWheel={scrollHorizontalStrip}>
      <FormatColorButton
        label={t('블록 테두리색')}
        icon={<Square size={16} aria-hidden="true" />}
        disabled={!canStyleBlock}
        config={{
          value: style?.borderColor ?? '#c9ced6',
          colors: BORDER_COLORS,
          onChange: onSetBlockBorderColor,
          clear: { label: t('기본 테두리색'), onClear: () => onSetBlockBorderColor('#c9ced6') },
        }}
      />
      {onSetBlockBorderWidth !== undefined ? (
        <Select
          className="format-bar-select note-select-border-width"
          ariaLabel={t('테두리 두께')}
          title={t('테두리 두께')}
          value={style?.borderWidth === undefined ? '' : String(style.borderWidth)}
          placeholder={t('두께')}
          options={borderWidthOptions}
          disabled={!canStyleBlock}
          onChange={(value) => onSetBlockBorderWidth(Number(value))}
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
