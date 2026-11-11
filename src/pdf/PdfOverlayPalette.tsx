import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ArrowUpRight, ArrowsHorizontal, BoundingBox, CaretDown, Circle, Eraser, Eyedropper, LineSegment, PaintBucket, PencilSimple, Rectangle, Square, TextAa, TextB, Trash, X } from '@phosphor-icons/react'
import { dashOf, dashPatch, isOverlayColor, isTextFill, LINE_WIDTHS, normalizeTextSize, OVERLAY_COLORS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP, TEXT_SIZES, type OverlayColor, type OverlayDash, type OverlayPatch, type PdfOverlay } from '../core/pdfOverlays'
import type { OverlayStyle, OverlayTool } from './PdfOverlayLayer'
import { OVERLAY_FONTS, overlayFontLabel } from '../core/overlayFonts'
import { setFormatSampling, useFormatSampling, type ToolStyle } from './overlayToolStore'
import { Select } from '../ui/Select'
import { t } from '../i18n'
import '../ui/pdf-overlay.css'

/**
 * 도구 서식 띠: 문서 도구줄 바로 아래에 붙는 한 줄(문서를 가리지 않는다). 편집 도구·형광펜·박스 메모가 같은 띠를 쓴다.
 * 왼쪽 칩 = 지금 도구(누르면 끄기), 가운데 = 그 도구의 서식, 오른쪽 = 조작 안내와 닫기(Esc).
 */
export function DocFormatStrip({ icon, label, onClose, hint, children }: {
  readonly icon: ReactNode
  readonly label: string
  readonly onClose: () => void
  readonly hint?: ReactNode
  readonly children?: ReactNode
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Esc: 글을 쓰는 칸 밖에서 누르면 도구를 끈다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/iu.test(target.tagName))) return
      if (document.querySelector('[role=menu], [role=dialog]') !== null) return
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 띠는 문서 칸(.pane-frame)에 붙인다: 쪽 칸(.pdf-split-cell)은 넘침을 잘라 내고, 문서는 띠 밑에서 시작해야 한다
  const [host, setHost] = useState<HTMLElement | null>(null)
  const anchorRef = useCallback((element: HTMLSpanElement | null) => {
    setHost(element?.closest<HTMLElement>('.pane-frame') ?? null)
  }, [])
  // 자리가 모자라면 먼저 조작 안내(hint)를, 그래도 모자라면 Esc 표시를 감춘다(겹침·찌그러짐 방지). 안내는 칩 풍선 도움말로 옮긴다.
  // 그래도 안 들어가면 띠가 옆으로 밀리고, 잘린 쪽 끝은 흐려져 더 있다는 것을 보인다
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ hint: true, kbd: true })
  useLayoutEffect(() => {
    const element = stripRef.current
    if (element === null) return undefined
    const measure = () => {
      const style = getComputedStyle(element)
      const gap = Number.parseFloat(style.columnGap) || 0
      const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
      const widthOf = (child: Element | null) => (child === null ? 0 : child.getBoundingClientRect().width)
      const fixed = Array.from(element.children).filter((child) => !child.classList.contains('doc-strip-hint') && !child.classList.contains('doc-strip-kbd'))
      const hintEl = element.querySelector('.doc-strip-hint')
      const kbdEl = element.querySelector('.doc-strip-kbd')
      const base = pad + fixed.reduce((sum, child) => sum + widthOf(child), 0)
      const withKbd = base + widthOf(kbdEl) + gap * fixed.length
      const withAll = withKbd + (hintEl === null ? 0 : widthOf(hintEl) + gap)
      const room = element.clientWidth + 0.5
      const next = { hint: withAll <= room, kbd: withKbd <= room }
      setFit((now) => (now.hint === next.hint && now.kbd === next.kbd ? now : next))
      // 밀리는 띠: 잘린 쪽 가장자리를 흐리게
      const max = element.scrollWidth - element.clientWidth
      element.dataset.edge = max <= 1 ? 'none' : element.scrollLeft <= 1 ? 'end' : element.scrollLeft >= max - 1 ? 'start' : 'both'
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of Array.from(element.children)) observer.observe(child)
    element.addEventListener('scroll', measure, { passive: true })
    // 가로로 밀리는 띠는 마우스 휠(세로)로도 옆으로 민다
    const onWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth + 1 || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      event.preventDefault()
      element.scrollLeft += event.deltaY
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
      element.removeEventListener('wheel', onWheel)
    }
  }, [hint, children, host])
  const hintText = typeof hint === 'string' ? hint : null
  const chipTitle = t('{label} 끄기', { label }) + (!fit.hint && hintText !== null ? ` · ${hintText}` : '')
  const strip = (
    <div ref={stripRef} className="doc-format-strip" role="toolbar" aria-label={label} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="doc-strip-chip" title={chipTitle} onClick={onClose}>
        <span className="doc-strip-chip-icon" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
      <div className="doc-strip-body">{children}</div>
      {hint === undefined ? null : <span className={`doc-strip-hint${fit.hint ? '' : ' doc-strip-hint-off'}`}>{hint}</span>}
      <kbd className={`doc-strip-kbd${fit.kbd ? '' : ' doc-strip-kbd-off'}`}>Esc</kbd>
      <button type="button" className="doc-strip-close" aria-label={t('{label} 닫기', { label })} title={t('닫기 (Esc)')} onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
  return (
    <>
      <span ref={anchorRef} hidden />
      {host === null ? strip : createPortal(strip, host)}
    </>
  )
}

/** (예전 이름) 떠 있는 도구창 = 이제 서식 띠 */
export function PdfFloatPalette({ label, children, onDone, icon, hint }: { readonly label: string; readonly children?: ReactNode; readonly onDone: () => void; readonly icon?: ReactNode; readonly hint?: ReactNode }) {
  return <DocFormatStrip icon={icon} label={label} onClose={onDone} hint={hint}>{children}</DocFormatStrip>
}

export function StripSep() {
  return <span className="doc-strip-sep" aria-hidden="true" />
}

/** 색 일곱 + 직접 고르기 */
export function StripSwatches({ value, onChange, colors = OVERLAY_COLORS, custom = true }: {
  readonly value: string
  readonly onChange: (color: OverlayColor) => void
  readonly colors?: readonly string[]
  readonly custom?: boolean
}) {
  const known = colors.includes(value.toLowerCase())
  return (
    <span className="doc-strip-swatches" role="group" aria-label={t('색')}>
      {colors.map((color) => (
        <button key={color} type="button" className={`doc-strip-swatch${value.toLowerCase() === color ? ' doc-strip-swatch-on' : ''}`} style={{ background: color }} aria-label={t('색 {value}', { value: color })} aria-pressed={value.toLowerCase() === color} title={t('색')} onClick={() => onChange(color)} />
      ))}
      {custom ? (
        <label className={`doc-strip-swatch doc-strip-swatch-custom${known ? '' : ' doc-strip-swatch-on'}`} title={t('색 직접 고르기')} style={known ? undefined : { background: value }}>
          <input type="color" aria-label={t('색 직접 고르기')} value={isOverlayColor(value) ? value : '#d9363e'} onChange={(event) => onChange(event.currentTarget.value.toLowerCase())} />
        </label>
      ) : null}
    </span>
  )
}

export function StripWidths({ value, onChange }: { readonly value: number; readonly onChange: (width: number) => void }) {
  return (
    <span className="doc-strip-seg" role="group" aria-label={t('선 굵기')}>
      {LINE_WIDTHS.map((width) => (
        <button key={width} type="button" className={`doc-strip-opt${value === width ? ' doc-strip-opt-on' : ''}`} aria-label={t('굵기 {width}', { width })} aria-pressed={value === width} title={t('굵기 {width}', { width })} onClick={() => onChange(width)}>
          <i className="doc-strip-line" style={{ height: Math.max(width, 1) }} />
        </button>
      ))}
    </span>
  )
}

const DASHES: readonly { value: OverlayDash; label: string }[] = [
  { value: 'solid', label: '실선' },
  { value: 'dash', label: '점선' },
  { value: 'dot', label: '짧은 점선' },
]
export function StripDash({ value, onChange }: { readonly value: OverlayDash; readonly onChange: (dash: OverlayDash) => void }) {
  return (
    <span className="doc-strip-seg" role="group" aria-label={t('선 모양')}>
      {DASHES.map((item) => (
        <button key={item.value} type="button" className={`doc-strip-opt${value === item.value ? ' doc-strip-opt-on' : ''}`} aria-label={t(item.label)} aria-pressed={value === item.value} title={t(item.label)} onClick={() => onChange(item.value)}>
          <i className={`doc-strip-line doc-strip-line-${item.value}`} />
        </button>
      ))}
    </span>
  )
}

type Heads = 'none' | 'end' | 'both'
export function StripHeads({ value, onChange }: { readonly value: Heads; readonly onChange: (heads: Heads) => void }) {
  const items: readonly { value: Heads; label: string; icon: ReactNode }[] = [
    { value: 'none', label: '화살촉 없음', icon: <LineSegment size={15} /> },
    { value: 'end', label: '끝에 화살촉', icon: <ArrowRight size={15} /> },
    { value: 'both', label: '양쪽 화살촉', icon: <ArrowsHorizontal size={15} /> },
  ]
  return (
    <span className="doc-strip-seg" role="group" aria-label={t('화살촉')}>
      {items.map((item) => (
        <button key={item.value} type="button" className={`doc-strip-opt${value === item.value ? ' doc-strip-opt-on' : ''}`} aria-label={t(item.label)} aria-pressed={value === item.value} title={t(item.label)} onClick={() => onChange(item.value)}>
          {item.icon}
        </button>
      ))}
    </span>
  )
}

/** 글자 크기 칸: 4~144 pt 아무 값이나(0.5 단위) 쓰고, ↑↓ 로 한 칸(Shift 는 5)씩, ▾ 로 자주 쓰는 크기를 고른다 */
export function StripSizeField({ value, onChange }: { readonly value: number; readonly onChange: (size: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const show = (size: number) => (Number.isInteger(size) ? String(size) : size.toFixed(1))
  const commit = (text: string) => {
    const parsed = Number(text.trim().replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const next = normalizeTextSize(parsed)
    if (next !== value) onChange(next)
  }
  const stepBy = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const typed = draft === null ? Number.NaN : Number(draft.replace(',', '.'))
      const base = Number.isFinite(typed) ? typed : value
      const delta = (event.shiftKey ? 10 : 1) * TEXT_SIZE_STEP * (event.key === 'ArrowUp' ? 1 : -1)
      const next = normalizeTextSize(base + delta)
      setDraft(null)
      if (next !== value) onChange(next)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget.value)
      event.currentTarget.select()
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false) } else setDraft(null)
    }
  }
  useLayoutEffect(() => {
    if (!open) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect !== undefined) setPlace({ left: rect.left, top: rect.bottom + 4, width: rect.width })
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    const away = (event: Event) => { if (!listRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [open])
  return (
    <span ref={wrapRef} className={`doc-strip-size${open ? ' doc-strip-size-open' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={t('글자 크기')}
        aria-valuemin={TEXT_SIZE_MIN}
        aria-valuemax={TEXT_SIZE_MAX}
        aria-valuenow={value}
        title={t('글자 크기 (pt) · ↑↓ 로 0.5씩')}
        data-undo-passthrough={draft === null ? 'true' : undefined}
        value={draft ?? show(value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => { if (draft !== null) commit(event.currentTarget.value) }}
        onKeyDown={stepBy}
      />
      <span className="doc-strip-size-unit" aria-hidden="true">pt</span>
      <button type="button" className="doc-strip-size-caret" aria-label={t('자주 쓰는 크기')} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((on) => !on)}>
        <CaretDown size={12} weight="bold" aria-hidden="true" />
      </button>
      {open && place !== null ? createPortal(
        <div ref={listRef} id={listId} role="listbox" aria-label={t('자주 쓰는 크기')} className="app-select-list doc-strip-size-list" style={{ left: place.left, top: place.top, minWidth: place.width }}>
          {TEXT_SIZES.map((size) => (
            <div key={size} role="option" aria-selected={size === value} className="app-select-option" onPointerDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); if (size !== value) onChange(size) }}>
              <span className="app-select-option-label">{show(size)} pt</span>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  )
}

/** 색 하나를 직접 고르는 작은 동그라미(테두리색). value 가 없으면 fallback 색 */
export function StripColorDot({ value, label, onChange, fallback }: { readonly value: string | null; readonly label: string; readonly onChange: (color: OverlayColor) => void; readonly fallback?: string }) {
  const set = value !== null && isOverlayColor(value)
  return (
    <label className={`doc-strip-swatch doc-strip-swatch-custom${set ? ' doc-strip-swatch-on' : ''}`} title={label} style={set ? { background: value } : fallback !== undefined ? { background: fallback } : undefined}>
      <input type="color" aria-label={label} value={set ? value : isOverlayColor(fallback) ? fallback : '#ffffff'} onChange={(event) => onChange(event.currentTarget.value.toLowerCase())} />
    </label>
  )
}

export function StripToggle({ on, label, onChange, children }: { readonly on: boolean; readonly label: string; readonly onChange: (on: boolean) => void; readonly children: ReactNode }) {
  return (
    <button type="button" className={`doc-strip-toggle${on ? ' doc-strip-opt-on' : ''}`} aria-label={label} aria-pressed={on} title={label} onClick={() => onChange(!on)}>
      {children}
    </button>
  )
}

/** 편집 도구 일곱(도구줄에는 글 상자 · 그리기 ▾ · 지우개로 나온다). 단축키는 글 고르는 칸 밖에서 */
export const OVERLAY_TOOLS: readonly { id: OverlayTool; label: string; shortcut: string; icon: (size: number, active: boolean) => ReactNode }[] = [
  { id: 'text', label: '글 상자', shortcut: 'T', icon: (size, active) => <TextAa size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'pen', label: '펜', shortcut: 'P', icon: (size, active) => <PencilSimple size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'line', label: '선', shortcut: 'L', icon: (size, active) => <LineSegment size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'arrow', label: '화살표', shortcut: 'A', icon: (size, active) => <ArrowUpRight size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'rect', label: '네모', shortcut: 'R', icon: (size, active) => <Square size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'ellipse', label: '동그라미', shortcut: 'O', icon: (size, active) => <Circle size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
  { id: 'redact', label: '가리기', shortcut: 'X', icon: (size, active) => <Rectangle size={size} weight={active ? 'fill' : 'duotone'} aria-hidden="true" /> },
  { id: 'eraser', label: '지우개', shortcut: 'E', icon: (size, active) => <Eraser size={size} weight={active ? 'bold' : 'regular'} aria-hidden="true" /> },
]
export const overlayToolInfo = (id: OverlayTool) => OVERLAY_TOOLS.find((item) => item.id === id) ?? OVERLAY_TOOLS[0]!

const KIND_LABEL: Record<PdfOverlay['kind'], string> = { text: '고른 글 상자', line: '고른 선', ink: '고른 펜 획', shape: '고른 도형' }
const REDACT_LABEL = '고른 가리기 상자'
const TOOL_HINT: Partial<Record<OverlayTool, string>> = {
  text: '끌면 그 너비로 · 누르면 바로 쓰기',
  pen: '누른 채 그리기',
  line: 'Shift: 수평·수직·45°',
  arrow: 'Shift: 수평·수직·45°',
  rect: 'Shift: 정사각형',
  ellipse: 'Shift: 원',
  redact: '끌어서 가릴 곳 지정 · 「PDF 도구 → 민감 정보 가린 PDF 저장」을 만들면 그 자리 글자가 정말 지워집니다',
  eraser: '누른 채 지나가면 지움 (형광펜·박스 메모 포함)',
}

interface PdfOverlayPaletteProps {
  readonly tool: OverlayTool
  readonly style: OverlayStyle
  /** (예전) 도구창 안에서 도구 바꾸기. 이제 도구는 도구줄에 있어 쓰지 않는다 */
  readonly onToolChange?: (tool: OverlayTool) => void
  readonly onStyleChange: (patch: Partial<ToolStyle>) => void
  /** 고른 덮개. 있으면 서식 단추가 그것을 바꾼다(없으면 새로 만들 것의 서식) */
  readonly selected?: PdfOverlay | null
  readonly onUpdateSelected?: (patch: OverlayPatch) => void
  readonly onRemoveSelected?: () => void
  readonly onDone: () => void
}

const FILLS: readonly { value: 'none' | 'white' | 'yellow'; label: string; swatch: string }[] = [
  { value: 'none', label: '바탕 없음', swatch: 'transparent' },
  { value: 'white', label: '흰 바탕(아래 글 가리기)', swatch: '#ffffff' },
  { value: 'yellow', label: '노란 바탕', swatch: '#fff3a8' },
]

/**
 * 편집 도구의 서식 띠. 무엇을 고른 채면 서식이 그것에 바로 걸리고, 아무것도 안 고르면 그 도구로 새로 만들 것의 서식(도구마다 기억)이다.
 */
export function PdfOverlayPalette({ tool, style, onStyleChange, selected = null, onUpdateSelected, onRemoveSelected, onDone }: PdfOverlayPaletteProps) {
  const info = overlayToolInfo(tool)
  // 서식 대상: 고른 덮개, 없으면 지금 도구로 새로 만들 것
  const redactSelected = selected?.kind === 'shape' && selected.shape === 'redact'
  // 가리기 상자에는 서식이 없다(늘 검게 덮는다)
  const target: 'text' | 'pen' | 'line' | 'shape' | null = redactSelected ? null : selected !== null
    ? selected.kind === 'text' ? 'text' : selected.kind === 'line' ? 'line' : selected.kind === 'shape' ? 'shape' : 'pen'
    : tool === 'text' ? 'text' : tool === 'line' || tool === 'arrow' ? 'line' : tool === 'rect' || tool === 'ellipse' ? 'shape' : tool === 'pen' ? 'pen' : null
  const set = (stylePatch: Partial<ToolStyle>, selectedPatch: OverlayPatch) => (selected !== null ? onUpdateSelected?.(selectedPatch) : onStyleChange(stylePatch))
  const color = selected?.color ?? style.color
  const lineWidth = selected !== null && selected.kind !== 'text' ? selected.width : style.lineWidth
  const textSize = selected?.kind === 'text' ? selected.size : style.textSize
  const bold = selected?.kind === 'text' ? selected.bold === true : style.bold
  const textFill: string = selected?.kind === 'text' ? selected.fill ?? 'none' : style.textFill
  const customFill = isOverlayColor(textFill) ? textFill : null
  const border = selected?.kind === 'text' ? selected.border === true : style.border
  const borderColor = selected?.kind === 'text' ? selected.borderColor ?? '' : style.textBorderColor
  const font = selected?.kind === 'text' ? selected.font ?? '' : style.textFont
  const sampling = useFormatSampling()
  // 도구를 바꾸거나 띠가 사라지면 서식 가져오기도 끝낸다. Esc 는 도구가 아니라 서식 가져오기만 끈다
  useEffect(() => { setFormatSampling(false) }, [tool])
  useEffect(() => () => setFormatSampling(false), [])
  useEffect(() => {
    if (!sampling) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setFormatSampling(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sampling])
  const dash: OverlayDash = selected !== null && (selected.kind === 'line' || selected.kind === 'shape') ? dashOf(selected) : style.dash
  const heads: Heads = selected?.kind === 'line'
    ? selected.arrow === true ? selected.arrowStart === true ? 'both' : 'end' : 'none'
    : style.arrowEnd ? style.arrowStart ? 'both' : 'end' : 'none'
  const shapeFill = selected?.kind === 'shape' ? selected.fill === true : style.fill
  const label = redactSelected ? t(REDACT_LABEL) : selected !== null ? t(KIND_LABEL[selected.kind]) : t(info.label)
  const fontOptions = [
    { value: '', label: t('기본(맑은 고딕)') },
    ...OVERLAY_FONTS.map((item) => ({ value: item.id, label: item.korean ? t(item.label) : item.label })),
    ...(font === '' || OVERLAY_FONTS.some((item) => item.id === font) ? [] : [{ value: font, label: overlayFontLabel(font) ?? font }]),
  ]

  return (
    <DocFormatStrip
      icon={info.icon(15, false)}
      label={label}
      onClose={onDone}
      hint={sampling && target === 'text' ? t('서식을 가져올 글 상자나 PDF 글자를 누르세요 · Esc 로 취소') : selected === null && TOOL_HINT[tool] !== undefined ? t(TOOL_HINT[tool]!) : undefined}
    >
      {target === null ? null : (
        <>
          <StripSwatches value={color} onChange={(next) => set({ color: next }, { color: next })} />
          <StripSep />
          {target === 'text' ? (
            <>
              <Select
                className="doc-strip-select doc-strip-font"
                ariaLabel={t('글꼴')}
                value={font}
                options={fontOptions}
                onChange={(value) => set({ textFont: value }, { font: value === '' ? undefined : value })}
              />
              <StripSizeField value={textSize} onChange={(size) => set({ textSize: size }, { size })} />
              <StripToggle on={bold} label={t('굵게')} onChange={(next) => set({ bold: next }, { bold: next })}><TextB size={15} weight="bold" aria-hidden="true" /></StripToggle>
              <StripSep />
              <span className="doc-strip-seg" role="group" aria-label={t('바탕')}>
                {FILLS.map((item) => (
                  <button key={item.value} type="button" className={`doc-strip-opt${textFill === item.value ? ' doc-strip-opt-on' : ''}`} aria-label={t(item.label)} aria-pressed={textFill === item.value} title={t(item.label)} onClick={() => set({ textFill: item.value }, { fill: item.value === 'none' ? undefined : item.value })}>
                    {item.value === 'none' ? <span className="doc-strip-fill-none">{t('없음')}</span> : <span className="doc-strip-fill" style={{ background: item.swatch }} />}
                  </button>
                ))}
                <label className={`doc-strip-opt doc-strip-opt-color${customFill !== null ? ' doc-strip-opt-on' : ''}`} title={t('바탕색 직접 고르기')}>
                  <span className={`doc-strip-fill${customFill === null ? ' doc-strip-fill-rainbow' : ''}`} style={customFill === null ? undefined : { background: customFill }} />
                  <input type="color" aria-label={t('바탕색 직접 고르기')} value={customFill ?? '#ffffff'} onChange={(event) => { const next = event.currentTarget.value.toLowerCase(); if (isTextFill(next)) set({ textFill: next }, { fill: next }) }} />
                </label>
              </span>
              <StripToggle on={border} label={t('테두리')} onChange={(next) => set({ border: next }, { border: next })}><BoundingBox size={15} aria-hidden="true" /></StripToggle>
              {border ? (
                <StripColorDot value={borderColor === '' ? null : borderColor} fallback={color} label={t('테두리 색 직접 고르기')} onChange={(next) => set({ textBorderColor: next }, { borderColor: next })} />
              ) : null}
              <StripSep />
              <StripToggle on={sampling} label={t('서식 가져오기')} onChange={(next) => setFormatSampling(next)}><Eyedropper size={15} weight={sampling ? 'bold' : 'regular'} aria-hidden="true" /></StripToggle>
            </>
          ) : (
            <StripWidths value={lineWidth} onChange={(width) => set({ lineWidth: width }, { width })} />
          )}
          {target === 'line' || target === 'shape' ? (
            <>
              <StripSep />
              <StripDash value={dash} onChange={(next) => set({ dash: next }, dashPatch(next))} />
            </>
          ) : null}
          {target === 'line' ? (
            <StripHeads value={heads} onChange={(next) => set(
              { arrowEnd: next !== 'none', arrowStart: next === 'both' },
              { arrow: next !== 'none' ? true : undefined, arrowStart: next === 'both' ? true : undefined },
            )} />
          ) : null}
          {target === 'shape' ? (
            <StripToggle on={shapeFill} label={t('안을 옅게 칠하기')} onChange={(next) => set({ fill: next }, { fill: next ? true : undefined })}><PaintBucket size={15} aria-hidden="true" /></StripToggle>
          ) : null}
        </>
      )}
      {selected !== null && onRemoveSelected !== undefined ? (
        <>
          <StripSep />
          <button type="button" className="doc-strip-toggle" aria-label={t('고른 것 지우기')} title={t('지우기 (Delete)')} onClick={onRemoveSelected}><Trash size={15} aria-hidden="true" /></button>
        </>
      ) : null}
    </DocFormatStrip>
  )
}
