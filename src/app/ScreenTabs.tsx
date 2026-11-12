import { useEffect, useRef, useState } from 'react'
import { Plus, SquaresFour } from '@phosphor-icons/react'
import { t } from '../i18n'
import { insertionIndexAt } from './tabDock'
import { PopupMenu } from './PopupMenu'
import '../ui/screens.css'

export interface ScreenTabItem {
  readonly id: string
  readonly name: string
}

export interface ScreenTemplateItem {
  readonly id: string
  readonly label: string
  readonly hint: string
}

interface ScreenTabsProps {
  readonly screens: readonly ScreenTabItem[]
  readonly activeId: string
  /** 바로 앞에 보던 화면(`-` 표시) */
  readonly lastId: string | null
  /** 「＋」가 펼칠 새 화면 템플릿 */
  readonly templates: readonly ScreenTemplateItem[]
  readonly onSelect: (id: string) => void
  readonly onRename: (id: string, name: string) => void
  readonly onReorder: (id: string, toIndex: number) => void
  readonly onClose: (id: string) => void
  readonly onNew: (templateId: string) => void
}

/** 끌기로 치는 최소 움직임(px). 이보다 적게 움직이면 그냥 누른 것이다 */
const DRAG_THRESHOLD = 5

/**
 * 맨 위 줄의 화면 탭(tmux 의 window 목록): `0 읽기 · 1 비교 …`. 누르면 그 화면으로, 두 번 누르면 이름 바꾸기,
 * 끌어서 순서 바꾸기(Alt+←→ 도 된다), 우클릭으로 이름 바꾸기·닫기, 「＋」로 템플릿에서 새 화면.
 */
export function ScreenTabs({ screens, activeId, lastId, templates, onSelect, onRename, onReorder, onClose, onNew }: ScreenTabsProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; drop: number } | null>(null)
  const [menu, setMenu] = useState<{ kind: 'new'; left: number; top: number } | { kind: 'tab'; id: string; left: number; top: number } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const plusRef = useRef<HTMLButtonElement | null>(null)
  // 끌기를 마친 직후 따라오는 click 은 화면 이동이 아니다
  const suppressClick = useRef(false)
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])

  /** x 좌표가 가리키는 놓을 자리(끄는 탭을 뺀 나머지 기준) */
  const dropIndexAt = (id: string, x: number): number => {
    const rects = screens
      .filter((screen) => screen.id !== id)
      .map((screen) => listRef.current?.querySelector<HTMLElement>(`[data-screen-id="${screen.id}"]`)?.getBoundingClientRect())
      .filter((box): box is DOMRect => box !== undefined)
      .map((box) => ({ left: box.left, width: box.width }))
    return insertionIndexAt(rects, x)
  }

  const startDrag = (event: React.PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || editing !== null) return
    const startX = event.clientX
    let moved = false
    let drop = -1
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
      moved = true
      drop = dropIndexAt(id, ev.clientX)
      setDragging({ id, drop })
    }
    const finish = (ev: Event) => {
      cleanup()
      if (moved && ev.type === 'pointerup') {
        suppressClick.current = true
        window.setTimeout(() => { suppressClick.current = false }, 300)
        if (drop >= 0) onReorder(id, drop)
      }
      setDragging(null)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragCleanup.current = null
    }
    dragCleanup.current?.()
    dragCleanup.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const commitRename = (id: string, value: string) => {
    setEditing(null)
    onRename(id, value)
  }

  const menuTab = menu?.kind === 'tab' ? screens.find((screen) => screen.id === menu.id) : undefined

  return (
    <div className="topbar-screens" data-tauri-drag-region="false">
      <div ref={listRef} className="screen-tabs" role="tablist" aria-label={t('화면')}>
        {screens.map((screen, index) => {
          const active = screen.id === activeId
          const last = screen.id === lastId
          const dropHere = dragging !== null && dragging.id !== screen.id
          const others = screens.filter((candidate) => candidate.id !== dragging?.id)
          const dropBefore = dropHere && others[dragging.drop]?.id === screen.id
          const dropAfter = dropHere && dragging.drop >= others.length && others[others.length - 1]?.id === screen.id
          return (
            <div
              key={screen.id}
              data-screen-id={screen.id}
              data-dragging={dragging?.id === screen.id ? '' : undefined}
              data-drop={dropBefore ? 'before' : dropAfter ? 'after' : undefined}
              className={`screen-tab${active ? ' screen-tab-active' : ''}${last ? ' screen-tab-last' : ''}`}
              data-tauri-drag-region="false"
              onPointerDown={(event) => startDrag(event, screen.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ kind: 'tab', id: screen.id, left: Math.min(event.clientX, window.innerWidth - 240), top: event.clientY + 4 })
              }}
            >
              {editing === screen.id ? (
                <input
                  className="screen-tab-input"
                  aria-label={t('화면 이름')}
                  defaultValue={screen.name}
                  autoFocus
                  maxLength={40}
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => commitRename(screen.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') { event.preventDefault(); commitRename(screen.id, event.currentTarget.value) }
                    else if (event.key === 'Escape') { event.preventDefault(); setEditing(null) }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="screen-tab-button"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  title={t('{name} (화면 {index}) · 두 번 눌러 이름 바꾸기, 끌어서 순서 바꾸기', { name: screen.name, index })}
                  onClick={() => { if (!suppressClick.current) onSelect(screen.id) }}
                  onDoubleClick={() => setEditing(screen.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'F2') { event.preventDefault(); setEditing(screen.id); return }
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    const step = event.key === 'ArrowRight' ? 1 : -1
                    if (event.altKey) { onReorder(screen.id, index + step); return }
                    const next = screens[(index + step + screens.length) % screens.length]
                    if (next !== undefined) {
                      onSelect(next.id)
                      window.setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-screen-id="${next.id}"] [role="tab"]`)?.focus(), 0)
                    }
                  }}
                >
                  <SquaresFour size={13} aria-hidden="true" className="screen-tab-icon" />
                  <span className="screen-tab-index">{index}</span>
                  <span className="screen-tab-name">{screen.name}</span>
                  {/* 보는 화면은 알약 모양이 이미 보여 준다(* 는 상태 줄에만). 바로 앞 화면만 - 로 흐리게 */}
                  {!active && last ? <span className="screen-tab-mark" aria-hidden="true">-</span> : null}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        ref={plusRef}
        type="button"
        className="screen-tab-new"
        aria-label={t('새 화면')}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'new'}
        title={t('새 화면 ▸ 템플릿')}
        data-tauri-drag-region="false"
        onClick={() => {
          if (menu?.kind === 'new') { setMenu(null); return }
          const box = plusRef.current?.getBoundingClientRect()
          setMenu({ kind: 'new', left: box?.left ?? 0, top: (box?.bottom ?? 0) + 4 })
        }}
      >
        <Plus size={14} weight="bold" aria-hidden="true" />
      </button>
      {menu?.kind === 'new' ? (
        <PopupMenu label={t('새 화면')} left={menu.left} top={menu.top} anchorRef={plusRef} onClose={(restore) => { setMenu(null); if (restore) plusRef.current?.focus() }}>
          <div className="popup-menu-head" aria-hidden="true">{t('새 화면 ▸ 템플릿')}</div>
          {templates.map((template) => (
            <button key={template.id} type="button" role="menuitem" onClick={() => { setMenu(null); onNew(template.id) }}>
              <span>{template.label}</span><kbd>{template.hint}</kbd>
            </button>
          ))}
        </PopupMenu>
      ) : null}
      {menu?.kind === 'tab' && menuTab !== undefined ? (
        <PopupMenu label={t('{name} 화면 메뉴', { name: menuTab.name })} left={menu.left} top={menu.top} onClose={() => setMenu(null)}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing(menuTab.id) }}>
            <span>{t('이름 바꾸기')}</span><kbd>F2</kbd>
          </button>
          <button type="button" role="menuitem" disabled={screens.length <= 1} onClick={() => { setMenu(null); onClose(menuTab.id) }}>
            <span>{t('화면 닫기')}</span>
          </button>
        </PopupMenu>
      ) : null}
    </div>
  )
}
