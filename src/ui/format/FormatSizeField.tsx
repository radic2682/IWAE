import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react'
import { t } from '../../i18n'

/** 글자 크기 칸의 설정. 단위와 범위는 주인마다 다르다(글 상자 pt 4~144 · 0.5 단위, 캔버스 px 8~96) */
export interface FormatSizeConfig {
  readonly value: number
  readonly onChange: (size: number) => void
  readonly min: number
  readonly max: number
  /** ↑↓ 한 번에 움직이는 크기(Shift 는 열 배) */
  readonly step: number
  /** 칸 뒤에 붙는 단위(pt · px) */
  readonly unit: string
  /** ▾ 목록의 자주 쓰는 크기 */
  readonly presets: readonly number[]
  /** 쓴 값을 맞춘다(범위 · 단위). 없으면 범위로 자르고 step 단위로 반올림한다 */
  readonly normalize?: (size: number) => number
  /** 풍선 도움말 */
  readonly title?: string
  readonly disabled?: boolean
}

function defaultNormalize(size: number, min: number, max: number, step: number): number {
  const clamped = Math.min(Math.max(size, min), max)
  return Math.round(clamped / step) * step
}

/**
 * 글자 크기 칸: 아무 값이나 쓰고(Enter · 칸을 떠나면 정한다), ↑↓ 로 한 칸(Shift 는 열 칸)씩, ▾ 로 자주 쓰는 크기를 고른다.
 * 목록은 앱 드롭다운(Select)과 같은 모양이다.
 */
export function FormatSizeField({ value, onChange, min, max, step, unit, presets, normalize, title, disabled = false }: FormatSizeConfig) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const fit = (size: number) => (normalize === undefined ? defaultNormalize(size, min, max, step) : normalize(size))
  const show = (size: number) => (Number.isInteger(size) ? String(size) : size.toFixed(1))
  const commit = (text: string) => {
    const parsed = Number(text.trim().replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const next = fit(parsed)
    if (next !== value) onChange(next)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const typed = draft === null ? Number.NaN : Number(draft.replace(',', '.'))
      const base = Number.isFinite(typed) ? typed : value
      const delta = (event.shiftKey ? 10 : 1) * step * (event.key === 'ArrowUp' ? 1 : -1)
      const next = fit(base + delta)
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
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return (
    <span ref={wrapRef} className={`format-bar-size${open ? ' format-bar-size-open' : ''}${disabled ? ' format-bar-size-disabled' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={t('글자 크기')}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        title={title ?? t('글자 크기')}
        disabled={disabled}
        data-undo-passthrough={draft === null ? 'true' : undefined}
        value={draft ?? show(value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => { if (draft !== null) commit(event.currentTarget.value) }}
        onKeyDown={onKeyDown}
      />
      <span className="format-bar-size-unit" aria-hidden="true">{unit}</span>
      <button
        type="button"
        className="format-bar-size-caret"
        aria-label={t('자주 쓰는 크기')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((on) => !on)}
      >
        <CaretDown size={12} weight="bold" aria-hidden="true" />
      </button>
      {open && place !== null ? createPortal(
        <div ref={listRef} id={listId} role="listbox" aria-label={t('자주 쓰는 크기')} className="app-select-list format-bar-size-list" style={{ left: place.left, top: place.top, minWidth: place.width }}>
          {presets.map((size) => (
            <div key={size} role="option" aria-selected={size === value} className="app-select-option" onPointerDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); if (size !== value) onChange(size) }}>
              <span className="app-select-option-label">{show(size)} {unit}</span>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  )
}
