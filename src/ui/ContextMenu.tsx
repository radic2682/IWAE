import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { fitMenuInViewport } from './fitMenu'
import { createPortal } from 'react-dom'
import './context-menu.css'

export interface ContextMenuItem {
  readonly key: string
  readonly icon: ReactNode
  readonly label: string
  readonly onSelect?: () => void
  readonly shortcut?: string
  readonly danger?: boolean
  readonly disabled?: boolean
  /** 지금 고른 것(칠해 둔다) */
  readonly current?: boolean
}

/** 구분선 또는 안내 한 줄 */
export type ContextMenuEntry = ContextMenuItem | { readonly key: string; readonly separator: true } | { readonly key: string; readonly note: string }

/**
 * 문서 위에 뜨는 우클릭 메뉴(왼쪽 바 메뉴와 같은 꼴). 바깥을 누르거나 Esc·창 전환이면 닫힌다.
 * 창 끝에서 열면 창 안으로 들어오게 옮긴다.
 */
export function ContextMenu({ x, y, label, entries, onClose }: {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly entries: readonly ContextMenuEntry[]
  readonly onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    fitMenuInViewport(element)
  }, [x, y])
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return createPortal(
    <div ref={ref} className="app-context-menu" role="menu" aria-label={label} style={{ left: x, top: y }} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry) => {
        if ('separator' in entry) return <hr key={entry.key} className="app-context-sep" />
        if ('note' in entry) return <p key={entry.key} className="app-context-note">{entry.note}</p>
        return (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={[entry.danger === true ? 'app-context-danger' : '', entry.current === true ? 'app-context-current' : ''].filter(Boolean).join(' ') || undefined}
            aria-checked={entry.current === undefined ? undefined : entry.current}
            onClick={() => { onClose(); entry.onSelect?.() }}
          >
            <span className="app-context-icon" aria-hidden="true">{entry.icon}</span>
            <span className="app-context-label">{entry.label}</span>
            {entry.shortcut === undefined ? null : <kbd className="app-context-kbd">{entry.shortcut}</kbd>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
