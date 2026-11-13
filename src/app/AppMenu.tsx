import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { platformShortcut } from '../core/platform'

export interface AppMenuItem {
  readonly id: string
  readonly label: string
  /** 오른쪽에 붙는 단축키·상태 글자 */
  readonly hint?: string
  readonly onSelect: () => void
}

/** 묶음 사이에 선을 긋는다. 빈 묶음은 건너뛴다 */
export type AppMenuGroups = readonly (readonly AppMenuItem[])[]

/**
 * 상단바 맨 왼쪽의 로고 단추. 누르면 앱 전체에 관한 일(인쇄·화면·업데이트·설정)을 모은 메뉴가 열린다.
 * 사이드바를 접어도 상단바에 남으므로 설정에 늘 닿는다.
 */
export function AppMenu({ groups }: { readonly groups: AppMenuGroups }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (open === null) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (buttonRef.current?.contains(event.target) || panelRef.current?.contains(event.target))) return
      setOpen(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(null)
      buttonRef.current?.focus()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape)
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const shown = groups.filter((group) => group.length > 0)
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-tour="app-menu"
        className={`topbar-app-menu${open !== null ? ' topbar-app-menu-open' : ''}`}
        aria-label={t('IWAE 메뉴')}
        title={t('IWAE 메뉴')}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setOpen((current) => (current !== null ? null : { top: rect.bottom + 6, left: rect.left }))
        }}
      >
        <img src="/iwae-logo.png" alt="" aria-hidden="true" />
      </button>
      {open === null ? null : createPortal(
        <div
          ref={panelRef}
          className="app-menu"
          role="menu"
          aria-label={t('IWAE 메뉴')}
          style={{ top: open.top, left: open.left }}
          onKeyDown={(event) => {
            // ↑↓ 로 항목을 옮겨 다니고, Home·End 로 처음·끝으로 간다(Tab 은 그대로 둔다)
            const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('.app-menu-item') ?? [])
            if (items.length === 0) return
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'ArrowDown' ? (index + 1) % items.length
              : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
                : event.key === 'Home' ? 0
                  : event.key === 'End' ? items.length - 1
                    : null
            if (next === null) return
            event.preventDefault()
            items[next]?.focus()
          }}
        >
          {shown.map((group, index) => (
            <div key={group[0]?.id ?? index} className="app-menu-group" role="group">
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="app-menu-item"
                  onClick={() => {
                    setOpen(null)
                    item.onSelect()
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint === undefined ? null : <span className="app-menu-hint">{platformShortcut(item.hint)}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
