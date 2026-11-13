import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import {
  Code, DotsSixVertical, DotsThree, HighlighterCircle, PushPin, ListBullets, ListChecks, ListNumbers, TextAa, TextAlignCenter, TextAlignLeft, TextAlignRight,
  TextB, TextItalic, TextStrikethrough, TextTSlash, TextUnderline,
} from '@phosphor-icons/react'
import { Select, type SelectOption } from '../Select'
import { PopupMenu } from '../../app/PopupMenu'
import { FormatSizeField, type FormatSizeConfig } from './FormatSizeField'
import { fitMenuInViewport } from '../fitMenu'
import { t } from '../../i18n'
import type { FormatHostKind } from './formatBarPlace'
import { useFormatBarPlace } from './useFormatBarPlace'

/**
 * 서식 줄 하나(노트 메모 · 캔버스 글 블록 · PDF/MD 글 상자 · 박스 메모가 같이 쓴다).
 * 그리는 것은 묶음(문단 · 글자 모양 · 정렬 · 목록 · 색)과 주인이 덧붙이는 묶음뿐이고, 무엇을 할지(명령)는 주인이 넘긴다 —
 * 노트는 contentEditable 의 execCommand, 캔버스는 블록 서식 명령, 글 상자는 덮개 고치기. 주인이 넘기지 않은 묶음은 그리지 않는다.
 * 모든 단추는 누를 때 초점을 가져오지 않는다(pointerdown preventDefault): 글 쓰는 칸의 고른 글 · 커서 · 한글 조합이 그대로 남는다.
 * 폭이 모자라면 뒤쪽 묶음부터 「⋯」 메뉴로 접는다(접는 자리 안에 있을 때만: 노트 도구줄 .note-format-dock · data-format-fold-host).
 */

export type FormatMarkId = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
export type FormatListId = 'bullet' | 'number' | 'check'
export type FormatAlign = 'left' | 'center' | 'right'
export type FormatGroupId = 'block' | 'marks' | 'align' | 'lists' | 'color'
/** 풍선 도움말에 덧붙일 단축 안내를 받을 수 있는 단추 */
export type FormatShortcutId = FormatMarkId | FormatListId | 'clear'

export interface FormatToggle {
  /** 지금 켜져 있는가(모르면 undefined: 눌림 표시를 하지 않는다) */
  readonly active?: boolean
  readonly onToggle: () => void
}

export interface FormatSwatch {
  /** 색 이름(한국어, 화면에 낼 때 번역한다) */
  readonly name: string
  /** 고르면 onChange 로 가는 값 */
  readonly value: string
  /** 칸에 칠할 색(값이 색 이름이 아닐 때. 예: 글 상자 바탕 'white') */
  readonly swatch?: string
}

export interface FormatColorConfig {
  /** 지금 색(모르면 undefined: 단추 밑 색 막대를 그리지 않는다) */
  readonly value?: string
  readonly colors: readonly FormatSwatch[]
  readonly onChange: (value: string) => void
  /** 팔레트 아래 「기본으로」 단추 글과 동작 */
  readonly clear?: { readonly label: string; readonly onClear: () => void }
  /** 색 직접 고르기 칸을 둔다 */
  readonly custom?: boolean
  /** 이름을 바꾼다(기본: 글자색 · 글자 배경색) */
  readonly label?: string
  readonly icon?: ReactNode
}

export interface FormatChoiceConfig {
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly onChange: (value: string) => void
}

export interface FormatExtra {
  readonly key: string
  readonly node: ReactNode
}

export interface FormatBarProps {
  /** 도구줄 이름(스크린 리더) */
  readonly label: string
  /** 쓰는 칸이 없을 때의 꺼진 서식 줄 */
  readonly disabled?: boolean
  readonly className?: string
  /** 주인 종류(자리를 종류별로 기억한다). 안 넘기면 놓인 자리를 보고 알아낸다 */
  readonly hostKind?: FormatHostKind
  /** 문단 모양(본문 · 제목 · 인용 …) */
  readonly block?: FormatChoiceConfig
  readonly fontFamily?: FormatChoiceConfig
  readonly fontSize?: FormatSizeConfig
  readonly marks?: Partial<Record<FormatMarkId, FormatToggle>>
  readonly align?: { readonly value: FormatAlign | null; readonly onChange: (align: FormatAlign) => void }
  readonly lists?: Partial<Record<FormatListId, FormatToggle>>
  readonly textColor?: FormatColorConfig
  readonly highlight?: FormatColorConfig
  /** 서식 지우기 */
  readonly clear?: () => void
  /** 단추 풍선 도움말 뒤에 붙는 단축 안내(「굵게 (Ctrl+B)」). 주인마다 되는 단축이 달라 주인이 넘긴다 */
  readonly shortcuts?: Partial<Record<FormatShortcutId, string>>
  /** 묶음 끝에 덧붙이는 것(노트의 표 메뉴는 목록 묶음 끝) */
  readonly slots?: Partial<Record<'lists' | 'color', ReactNode>>
  /** 맨 뒤에 따로 붙는 묶음들(캔버스의 블록 배경색, 글 상자의 테두리 · 서식 가져오기) */
  readonly extras?: readonly FormatExtra[]
  /** 명령을 하나 실행한 뒤(노트: 빈 칸 안내를 다시 본다) */
  readonly onCommand?: () => void
}

const MARKS: readonly { id: FormatMarkId; label: string; icon: ReactNode }[] = [
  { id: 'bold', label: '굵게', icon: <TextB size={16} weight="bold" aria-hidden="true" /> },
  { id: 'italic', label: '기울임', icon: <TextItalic size={16} aria-hidden="true" /> },
  { id: 'underline', label: '밑줄', icon: <TextUnderline size={16} aria-hidden="true" /> },
  { id: 'strike', label: '취소선', icon: <TextStrikethrough size={16} aria-hidden="true" /> },
  { id: 'code', label: '인라인 코드', icon: <Code size={16} weight="bold" aria-hidden="true" /> },
]
const ALIGNS: readonly { id: FormatAlign; label: string; icon: ReactNode }[] = [
  { id: 'left', label: '왼쪽 정렬', icon: <TextAlignLeft size={16} aria-hidden="true" /> },
  { id: 'center', label: '가운데 정렬', icon: <TextAlignCenter size={16} aria-hidden="true" /> },
  { id: 'right', label: '오른쪽 정렬', icon: <TextAlignRight size={16} aria-hidden="true" /> },
]
const LISTS: readonly { id: FormatListId; label: string; icon: ReactNode }[] = [
  { id: 'bullet', label: '글머리 목록', icon: <ListBullets size={16} aria-hidden="true" /> },
  { id: 'number', label: '번호 목록', icon: <ListNumbers size={16} aria-hidden="true" /> },
  { id: 'check', label: '할 일 목록', icon: <ListChecks size={16} aria-hidden="true" /> },
]

const hasAny = (record: Partial<Record<string, unknown>> | undefined) => record !== undefined && Object.values(record).some((value) => value !== undefined)

/** 주인이 넘긴 것으로 그릴 묶음(앞에서부터의 순서). 넘기지 않은 묶음은 없다 */
export function formatGroupsOf(props: Pick<FormatBarProps, 'block' | 'fontFamily' | 'fontSize' | 'marks' | 'align' | 'lists' | 'textColor' | 'highlight' | 'clear' | 'slots'>): FormatGroupId[] {
  const groups: FormatGroupId[] = []
  if (props.block !== undefined || props.fontFamily !== undefined || props.fontSize !== undefined) groups.push('block')
  if (hasAny(props.marks)) groups.push('marks')
  if (props.align !== undefined) groups.push('align')
  if (hasAny(props.lists) || props.slots?.lists !== undefined) groups.push('lists')
  if (props.textColor !== undefined || props.highlight !== undefined || props.clear !== undefined || props.slots?.color !== undefined) groups.push('color')
  return groups
}

/** 풍선 도움말: 「이름 (단축)」 — 앱 풍선(GlobalTooltip)이 괄호 안 단축을 키 모양으로 떼어 보인다 */
export function formatTitle(label: string, shortcut: string | undefined): string {
  return shortcut === undefined || shortcut === '' ? label : `${label} (${shortcut})`
}

/**
 * 서식 줄의 단추 하나(28px, 아이콘 16px). 누를 때 초점을 가져오지 않는다.
 * active 를 넘기면 눌림(aria-pressed)을 보이고, 넘기지 않으면(모름) 눌림 표시가 없다.
 */
export function FormatButton({ label, title, shortcut, active, disabled = false, onPress, children, className, haspopup, expanded, buttonRef }: {
  readonly label: string
  /** 풍선 도움말(없으면 label) */
  readonly title?: string
  readonly shortcut?: string
  readonly active?: boolean
  readonly disabled?: boolean
  readonly onPress: () => void
  readonly children: ReactNode
  readonly className?: string
  readonly haspopup?: 'menu' | 'dialog'
  readonly expanded?: boolean
  readonly buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`format-bar-btn${active === true ? ' format-bar-btn-on' : ''}${className === undefined ? '' : ` ${className}`}`}
      aria-label={label}
      title={formatTitle(title ?? label, shortcut)}
      aria-pressed={active}
      aria-haspopup={haspopup}
      aria-expanded={expanded}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}

/** 한 번에 하나의 서식 팝오버만 열린다: 새로 열리는 것이 앞의 것을 닫는다 */
let closeOpenPopover: (() => void) | null = null
function claimPopover(close: () => void) {
  if (closeOpenPopover !== null && closeOpenPopover !== close) closeOpenPopover()
  closeOpenPopover = close
}
function releasePopover(close: () => void) {
  if (closeOpenPopover === close) closeOpenPopover = null
}

/** 서식 줄이 띄운 것(팔레트 · 목록 · 메뉴)인가 — 「⋯」 메뉴와 팔레트가 서로를 바깥으로 보지 않게 */
const FORMAT_FLOATING = '[data-format-popover], .app-select-list'

/** 팔레트 폭(px): 칸 28px · 사이 5px · 안쪽 여백 8px · 테두리 1px. 여덟 칸까지는 한 줄, 그보다 많으면 한 줄에 일곱(캔버스의 세 줄 팔레트) */
export function paletteWidth(count: number): number {
  const columns = Math.max(1, count <= 8 ? count : 7)
  return columns * 28 + (columns - 1) * 5 + 18
}
const POPOVER_GUTTER = 8

/** 팝오버가 화면 안에 들도록 왼쪽 끝을 맞춘다 */
export function popoverLeft(triggerLeft: number, width: number, viewWidth: number): number {
  return Math.max(POPOVER_GUTTER, Math.min(triggerLeft, viewWidth - width - POPOVER_GUTTER))
}

/**
 * 색 단추 + 팔레트(글자색 · 글자 배경색 · 블록 배경색 …). 팔레트는 body 에 띄운다(도구줄이 잘라 내지 않게).
 * 칸을 눌러도 초점을 가져오지 않아, 노트에서 고른 글에 그대로 색이 걸린다.
 */
export function FormatColorButton({ label, icon, config, disabled = false, onCommand }: {
  readonly label: string
  readonly icon: ReactNode
  readonly config: FormatColorConfig
  readonly disabled?: boolean
  readonly onCommand?: () => void
}) {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(() => setPlace(null))
  const open = place !== null
  const width = paletteWidth(config.colors.length + (config.custom === true ? 1 : 0))
  useEffect(() => {
    if (!open) return undefined
    const close = closeRef.current
    claimPopover(close)
    const away = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') close()
        return
      }
      const target = event.target
      if (target instanceof Node && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return
      close()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', away)
    return () => {
      releasePopover(close)
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', away)
    }
  }, [open])
  const current = config.value === undefined ? undefined : config.colors.find((color) => color.value.toLowerCase() === config.value?.toLowerCase())
  const currentPaint = config.value === undefined ? undefined : current?.swatch ?? current?.value ?? config.value
  const pick = (value: string) => {
    config.onChange(value)
    setPlace(null)
    onCommand?.()
  }
  return (
    <>
      <FormatButton
        buttonRef={triggerRef}
        label={t('{label} 선택', { label })}
        title={label}
        className="format-bar-color"
        disabled={disabled}
        haspopup="dialog"
        expanded={open}
        onPress={() => {
          if (open) { setPlace(null); return }
          const rect = triggerRef.current?.getBoundingClientRect()
          setPlace({ left: popoverLeft(rect?.left ?? POPOVER_GUTTER, width, window.innerWidth), top: (rect?.bottom ?? 0) + 5 })
        }}
      >
        {icon}
        {currentPaint === undefined ? null : <span className="format-bar-color-current" style={{ background: currentPaint }} aria-hidden="true" />}
      </FormatButton>
      {open ? createPortal(
        <div
          ref={popoverRef}
          className="format-bar-palette"
          data-format-popover=""
          role="dialog"
          aria-label={t('{label} 팔레트', { label })}
          style={{ left: place.left, top: place.top, width }}
        >
          <div className="format-bar-swatches">
            {config.colors.map((color) => {
              const paint = color.swatch ?? color.value
              const on = config.value !== undefined && config.value.toLowerCase() === color.value.toLowerCase()
              return (
                <button
                  key={color.value}
                  type="button"
                  className={`format-bar-swatch${paint === 'transparent' ? ' format-bar-swatch-none' : ''}`}
                  style={{ background: paint }}
                  aria-label={`${label} ${t(color.name)}`}
                  title={t(color.name)}
                  aria-pressed={config.value === undefined ? undefined : on}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pick(color.value)}
                />
              )
            })}
            {config.custom === true ? (
              <label className="format-bar-swatch format-bar-swatch-custom" title={t('{label} 직접 고르기', { label })}>
                <input
                  type="color"
                  aria-label={t('{label} 직접 고르기', { label })}
                  value={/^#[0-9a-f]{6}$/iu.test(config.value ?? '') ? config.value : '#ffffff'}
                  onChange={(event) => {
                    config.onChange(event.currentTarget.value.toLowerCase())
                    onCommand?.()
                  }}
                />
              </label>
            ) : null}
          </div>
          {config.clear === undefined ? null : (
            <button
              type="button"
              className="format-bar-color-clear"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                config.clear?.onClear()
                setPlace(null)
                onCommand?.()
              }}
            >
              {config.clear.label}
            </button>
          )}
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export interface FormatMenuItem {
  readonly key: string
  readonly label: string
  /** 오른쪽에 흐리게 보이는 덧말 */
  readonly hint?: string
  readonly disabled?: boolean
  readonly onSelect: () => void
}

/** 단추 + 앱 팝업 메뉴(노트의 표 메뉴). 메뉴는 초점을 가져오지 않는다 */
export function FormatMenuButton({ label, icon, items, disabled = false, onCommand }: {
  readonly label: string
  readonly icon: ReactNode
  readonly items: readonly FormatMenuItem[]
  readonly disabled?: boolean
  readonly onCommand?: () => void
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef(() => setAt(null))
  useEffect(() => {
    if (at === null) return undefined
    const close = closeRef.current
    claimPopover(close)
    return () => releasePopover(close)
  }, [at])
  return (
    <>
      <FormatButton
        buttonRef={triggerRef}
        label={label}
        disabled={disabled}
        haspopup="menu"
        expanded={at !== null}
        onPress={() => {
          if (at !== null) { setAt(null); return }
          const rect = triggerRef.current?.getBoundingClientRect()
          setAt({ left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 4 })
        }}
      >
        {icon}
      </FormatButton>
      {at === null ? null : createPortal(
        <div data-format-popover="" className="format-bar-menu-host">
          <PopupMenu label={label} left={at.left} top={at.top} anchorRef={triggerRef} autoFocus={false} onClose={() => setAt(null)}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  item.onSelect()
                  setAt(null)
                  onCommand?.()
                }}
              >
                <span>{item.label}</span>
                {item.hint === undefined ? null : <span className="menu-value">{item.hint}</span>}
              </button>
            ))}
          </PopupMenu>
        </div>,
        document.body,
      )}
    </>
  )
}

/** 접는 자리: 노트 도구줄(상단바 · 노트 맨 위)과 캔버스 도구줄 */
const FOLD_HOST = '.note-format-dock, [data-format-fold-host]'

/** 서식 줄 용량에서 덜어 두는 여유(px): 소수 폭 · 서브픽셀 어림이 쌓여 한 줄에 안 들어가는 일이 없게 */
const FORMAT_SLACK_PX = 1
/** 「⋯」 단추가 차지하는 폭(px): 28px + 앞 여백 6px */
export const FORMAT_MORE_W = 34
/** 왼쪽 끝 손잡이가 차지하는 폭(px) */
export const FORMAT_GRIP_W = 20

/**
 * 서식 줄이 쓸 수 있는 폭(px). 줄은 내용 폭만큼만 차지해서(남는 자리는 접는 자리 맨 뒤에 있다) 줄 자신의 폭은 쓸 수 있는 폭이 아니다 —
 * 접는 자리 안쪽 폭에서 줄 곁의 다른 것들(검색 · 글 블록 · 펼치기 묶음, 캔버스의 되돌리기 단추와 그 여백)을 빼고, 줄의 음수 왼쪽 여백(-11px)을 돌려 더한다.
 * 접는 자리 밖(박스 메모 · 글 상자 띠)의 서식 줄은 줄 폭 그대로다.
 * 폭은 모두 `getBoundingClientRect()` 의 실제(소수) 폭이고 1px 여유를 둔다 — 소수 배율에서 반올림한 폭을 더하면 마지막 묶음이 둘째 줄로 밀려 잘렸다.
 */
export function formatCapacity(bar: HTMLElement): number {
  const host = bar.closest<HTMLElement>(FOLD_HOST)
  if (host === null) return bar.getBoundingClientRect().width
  const style = getComputedStyle(host)
  const number = (value: string) => Number.parseFloat(value) || 0
  let beside = 0
  for (const child of Array.from(host.children)) {
    if (!(child instanceof HTMLElement) || child === bar || child.contains(bar)) continue
    const own = getComputedStyle(child)
    beside += child.getBoundingClientRect().width + number(own.marginLeft) + number(own.marginRight)
  }
  const inner = host.getBoundingClientRect().width - number(style.paddingLeft) - number(style.paddingRight)
  return inner - beside - number(getComputedStyle(bar).marginLeft) - FORMAT_SLACK_PX
}

/** 묶음 폭들(앞에서부터)이 capacity 안에 몇 개 들어가는가. 다 안 들어가면 「⋯」 자리(moreWidth)를 남기고, 첫 묶음은 늘 남긴다 */
export function fitFormatClusters(widths: readonly number[], capacity: number, moreWidth: number): number {
  const all = widths.reduce((sum, width) => sum + width, 0)
  if (all <= capacity) return widths.length
  let used = moreWidth
  let count = 0
  for (const width of widths) {
    if (used + width > capacity) break
    used += width
    count += 1
  }
  return Math.max(count, 1)
}

/**
 * 접는 자리 안의 서식 줄은 늘 한 줄이다: 폭이 모자라면 뒤쪽 묶음부터 「⋯」 메뉴로 옮긴다. 첫 묶음과 「⋯」 은 늘 줄에 있다.
 * 묶음 폭은 줄에 있을 때 재어 두고(처음엔 모두 줄에 그린다) 그 폭으로 몇 개가 들어가는지 정한다. 접는 자리 밖의 서식 줄은 건드리지 않는다.
 */
function useFormatFold(barRef: RefObject<HTMLDivElement | null>, total: number, floating: boolean): [number, boolean, Dispatch<SetStateAction<boolean>>] {
  const [visible, setVisible] = useState(total)
  const [moreOpen, setMoreOpen] = useState(false)
  const widths = useRef<number[]>([])
  const [tick, setTick] = useState(0)
  // 묶음 수가 바뀌면(주인이 묶음을 더하거나 뺐다) 일단 모두 줄에 그려 새 묶음의 폭부터 잰다
  const totalRef = useRef(total)
  useLayoutEffect(() => {
    if (totalRef.current === total) return
    totalRef.current = total
    setVisible(total)
  }, [total])
  // 다시 재야 할 때만 tick 을 올린다: 줄 · 접는 자리 · 곁의 것 · 묶음의 크기가 바뀌었을 때, 자리에 무엇이 생기거나 사라졌을 때(검색이 펼쳐지고 노트 단추가 나타날 때)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null) return undefined
    const host = bar.closest(FOLD_HOST)
    const bump = () => setTick((value) => value + 1)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bump)
    // 줄은 내용 폭만큼만 차지하므로 줄 폭이 아니라 접는 자리의 폭 변화를 봐야 다시 넓어졌을 때 알아챈다.
    // 곁의 것도 본다(그 폭이 줄거나 늘어도 자리 폭은 그대로다). 나중에 생긴 것은 새로 보고(observeAll), 묶음(data-cluster)의 폭 변화도 본다
    const observeAll = () => {
      if (resize === null) return
      resize.disconnect()
      resize.observe(bar)
      if (host !== null) {
        resize.observe(host)
        for (const child of Array.from(host.children)) if (!child.contains(bar)) resize.observe(child)
      }
      for (const cluster of Array.from(bar.querySelectorAll(':scope > [data-cluster]'))) resize.observe(cluster)
    }
    observeAll()
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { observeAll(); bump() })
    if (host !== null) mutation?.observe(host, { childList: true })
    mutation?.observe(bar, { childList: true })
    return () => { resize?.disconnect(); mutation?.disconnect() }
  }, [barRef, floating])
  // 재는 것은 필요할 때만: 크기 · 구성이 바뀌어 tick 이 오르거나, 보이는 묶음 수 · 전체 수가 바뀔 때(렌더마다 재지 않는다)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null || floating || bar.closest(FOLD_HOST) === null) {
      if (visible !== total) setVisible(total)
      return
    }
    for (const element of Array.from(bar.querySelectorAll<HTMLElement>(':scope > [data-cluster]'))) {
      // 소수 배율에서도 어긋나지 않게 반올림된 offsetWidth 가 아니라 실제 폭으로 잰다
      widths.current[Number(element.dataset.cluster)] = element.getBoundingClientRect().width
    }
    widths.current.length = total
    const capacity = formatCapacity(bar)
    const known = widths.current
    if (capacity <= 0 || known.length < total || known.some((width) => !(width > 0))) return
    const next = fitFormatClusters(known, capacity - FORMAT_GRIP_W, FORMAT_MORE_W)
    if (next !== visible) setVisible(next)
  }, [barRef, tick, visible, total, floating])
  return [visible, moreOpen, setMoreOpen]
}

/** 서식 줄 */
export function FormatBar(props: FormatBarProps) {
  const { label, disabled = false, className, shortcuts = {}, onCommand } = props
  const barRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const gripRef = useRef<HTMLButtonElement | null>(null)
  const placed = useFormatBarPlace(props.hostKind, barRef, anchorRef, floatRef, gripRef)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const run = (action: () => void) => () => {
    action()
    onCommand?.()
  }
  const toggles = <T extends string>(defs: readonly { id: T; label: string; icon: ReactNode }[], record: Partial<Record<T, FormatToggle>> | undefined) =>
    defs.flatMap((def) => {
      const toggle = record?.[def.id]
      if (toggle === undefined) return []
      return [
        <FormatButton key={def.id} label={t(def.label)} shortcut={shortcuts[def.id as FormatShortcutId]} active={disabled ? undefined : toggle.active} disabled={disabled} onPress={run(toggle.onToggle)}>
          {def.icon}
        </FormatButton>,
      ]
    })
  const groups = formatGroupsOf(props)
  const groupNode = (group: FormatGroupId): ReactNode => {
    switch (group) {
      case 'block':
        return (
          <>
            {props.block === undefined ? null : (
              <Select
                className="format-bar-select format-bar-block"
                ariaLabel={t('문단 모양')}
                title={t('문단 모양')}
                keepFocus
                disabled={disabled}
                value={props.block.value}
                options={props.block.options}
                onChange={(value) => { props.block?.onChange(value); onCommand?.() }}
              />
            )}
            {props.fontFamily === undefined ? null : (
              <Select
                className="format-bar-select format-bar-font"
                ariaLabel={t('글꼴')}
                title={t('글꼴')}
                keepFocus
                disabled={disabled}
                value={props.fontFamily.value}
                options={props.fontFamily.options}
                onChange={(value) => { props.fontFamily?.onChange(value); onCommand?.() }}
              />
            )}
            {props.fontSize === undefined ? null : <FormatSizeField {...props.fontSize} disabled={disabled || props.fontSize.disabled === true} />}
          </>
        )
      case 'marks':
        return toggles(MARKS, props.marks)
      case 'align':
        return ALIGNS.map((def) => (
          <FormatButton key={def.id} label={t(def.label)} active={disabled ? undefined : props.align?.value === def.id} disabled={disabled} onPress={run(() => props.align?.onChange(def.id))}>
            {def.icon}
          </FormatButton>
        ))
      case 'lists':
        return (
          <>
            {toggles(LISTS, props.lists)}
            {props.slots?.lists}
          </>
        )
      case 'color':
        return (
          <>
            {props.textColor === undefined ? null : (
              <FormatColorButton label={props.textColor.label ?? t('글자색')} icon={props.textColor.icon ?? <TextAa size={16} aria-hidden="true" />} config={props.textColor} disabled={disabled} onCommand={onCommand} />
            )}
            {props.highlight === undefined ? null : (
              <FormatColorButton label={props.highlight.label ?? t('글자 배경색')} icon={props.highlight.icon ?? <HighlighterCircle size={16} aria-hidden="true" />} config={props.highlight} disabled={disabled} onCommand={onCommand} />
            )}
            {props.clear === undefined ? null : (
              <FormatButton label={t('서식 지우기')} shortcut={shortcuts.clear} disabled={disabled} onPress={run(props.clear)}>
                <TextTSlash size={16} aria-hidden="true" />
              </FormatButton>
            )}
            {props.slots?.color}
          </>
        )
    }
  }
  const clusters: ReactNode[] = [
    ...groups.map((group) => ({ key: group, node: groupNode(group), group })),
    ...(props.extras ?? []).map((extra) => ({ key: `extra:${extra.key}`, node: extra.node, group: 'extra' })),
  ].map((cluster, index) => (
    <span key={cluster.key} className="format-bar-cluster" data-cluster={index} data-group={cluster.group}>{cluster.node}</span>
  ))
  const [visible, moreOpen, setMoreOpen] = useFormatFold(barRef, clusters.length, placed.floating)
  const folded = visible < clusters.length
  const [panelAt, setPanelAt] = useState<CSSProperties | null>(null)
  useEffect(() => {
    if (!moreOpen) return undefined
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setMoreOpen(false)
        return
      }
      const target = event.target
      if (target instanceof Node && (barRef.current?.contains(target) || panelRef.current?.contains(target))) return
      if (target instanceof Element && target.closest(FORMAT_FLOATING) !== null) return
      setMoreOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [moreOpen, setMoreOpen])
  useLayoutEffect(() => {
    if (moreOpen && panelRef.current !== null) fitMenuInViewport(panelRef.current)
  }, [moreOpen, panelAt, visible])
  const centered = placed.place.mode === 'center' && !placed.floating
  const grip = (
    <button
      ref={gripRef}
      type="button"
      className="format-bar-grip"
      aria-label={t('서식바 옮기기')}
      title={t('서식바 옮기기')}
      onPointerDown={placed.onGripPointerDown}
      onKeyDown={placed.onGripKeyDown}
      onClick={(event) => event.preventDefault()}
    >
      <DotsSixVertical size={16} weight="bold" aria-hidden="true" />
    </button>
  )
  const bar = (
    <div
      ref={barRef}
      className={`format-bar${disabled ? ' format-bar-idle' : ''}${centered ? ' format-bar-center' : ''}${placed.floating ? ' format-bar-floating' : ''}${className === undefined ? '' : ` ${className}`}`}
      role="toolbar"
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {grip}
      {clusters.slice(0, visible)}
      {folded && !placed.floating ? (
        <button
          ref={moreRef}
          type="button"
          className="format-bar-btn format-bar-more"
          aria-label={t('서식 더 보기')}
          title={t('서식 더 보기')}
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const rect = moreRef.current?.getBoundingClientRect()
            setPanelAt({ left: rect?.left ?? 0, top: (rect?.bottom ?? 0) + 4 })
            setMoreOpen((open) => !open)
          }}
        >
          <DotsThree size={16} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {placed.floating ? (
        <span className="format-bar-cluster" data-group="dock">
          <FormatButton label={t('서식바 붙이기')} onPress={() => placed.dock()}>
            <PushPin size={16} aria-hidden="true" />
          </FormatButton>
        </span>
      ) : null}
      {moreOpen && folded && !placed.floating ? createPortal(
        <div ref={panelRef} className="format-bar format-bar-overflow" role="group" aria-label={t('서식 더 보기')} style={panelAt ?? undefined}>
          {clusters.slice(visible)}
        </div>,
        document.body,
      ) : null}
    </div>
  )
  if (!placed.floating) return bar
  const snap = placed.drag?.snap ?? null
  return (
    <>
      <span ref={anchorRef} className="format-bar-anchor" aria-hidden="true" />
      {createPortal(
        <div
          ref={floatRef}
          className="format-bar-float"
          data-dragging={placed.drag === null ? undefined : ''}
          style={{ left: placed.floatAt?.x ?? 0, top: placed.floatAt?.y ?? 0 }}
          onPointerDown={(event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault() }}
        >
          {bar}
        </div>,
        document.body,
      )}
      {snap === null ? null : createPortal(
        <div className="format-bar-snap" style={{ left: snap.left, top: snap.top, width: snap.width, height: snap.height }} />,
        document.body,
      )}
    </>
  )
}
