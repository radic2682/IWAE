import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, Check } from '@phosphor-icons/react'
import './select.css'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

/**
 * 앱 모양의 드롭다운(운영체제 기본 목록 대신): 둥근 단추를 누르면 그 아래에 같은 폭의 목록이 뜬다.
 * 키보드: ↑↓·Home·End 로 고르고 Enter·Space 로 정한다. Escape·바깥 누르기로 닫는다.
 */
export function Select({ value, options, onChange, ariaLabel, disabled = false, className, id }: {
  readonly value: string
  readonly options: readonly SelectOption[]
  readonly onChange: (value: string) => void
  readonly ariaLabel?: string
  readonly disabled?: boolean
  readonly className?: string
  readonly id?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const listId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]

  useLayoutEffect(() => {
    if (!open) return
    const button = buttonRef.current
    if (button === null) return
    const rect = button.getBoundingClientRect()
    const wanted = Math.min(options.length * 32 + 10, 320)
    const up = rect.bottom + wanted + 8 > window.innerHeight && rect.top > wanted + 8
    setPlace({ left: rect.left, top: up ? rect.top - 4 : rect.bottom + 4, width: rect.width, up })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return
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

  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelectorAll<HTMLElement>('[role=option]')[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (index: number) => {
    const option = options[index]
    setOpen(false)
    buttonRef.current?.focus()
    if (option !== undefined && option.value !== value) onChange(option.value)
  }
  const openList = () => {
    if (disabled) return
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openList()
      }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (event.key === 'Tab') { setOpen(false); return }
    const next = event.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1)
      : event.key === 'ArrowUp' ? Math.max(active - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? options.length - 1
            : null
    if (next !== null) { event.preventDefault(); setActive(next); return }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active) }
  }

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        className={`app-select${open ? ' app-select-open' : ''}${className === undefined ? '' : ` ${className}`}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="app-select-label">{selected?.label ?? ''}</span>
        <CaretDown size={13} weight="bold" aria-hidden="true" className="app-select-caret" />
      </button>
      {open && place !== null ? createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="app-select-list"
          style={{ left: place.left, top: place.top, minWidth: place.width, transform: place.up ? 'translateY(-100%)' : undefined }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`app-select-option${index === active ? ' app-select-option-active' : ''}`}
              onPointerEnter={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className="app-select-check" aria-hidden="true">{option.value === value ? <Check size={14} weight="bold" /> : null}</span>
              <span className="app-select-option-label">{option.label}</span>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
