import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowsLeftRight, CaretDown, Check, CopySimple, FilePdf, FileText, Graph, X } from '@phosphor-icons/react'
import type { PaneId, Tab, TabsState } from './tabs'
import { announceAction } from './actionFeedback'
import { t } from '../i18n'

interface PaneTabsMenuProps {
  state: TabsState
  label: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** 이 탭 줄이 속한 패널. 있으면 탭을 끌어 반대편 패널로 옮길 수 있다 */
  paneId?: PaneId
  onMoveTab?: (id: string, target: PaneId) => void
  /** 옮길 수 있는 패널과 메뉴 글(「가운데 패널로 옮기기」 등). 없으면 2단 기준 반대편 하나 */
  moveTargets?: readonly { readonly pane: PaneId; readonly label: string }[]
  /** 지금 만지는 패널인가. 단축키(Ctrl+W·Ctrl+Tab)가 이 패널에 듣는다 */
  focused?: boolean
  /** 같은 PDF 를 한 군데 더 연다(다른 쪽을 나란히 보려고) */
  onDuplicateTab?: (id: string) => void
  /** 쪽 편집(순서·회전·끼워 넣기) 대화상자를 연다 */
  onEditPages?: (id: string) => void
  /** 탭을 끌어 같은 줄의 toIndex 자리로 옮긴다 */
  onReorderTab?: (id: string, toIndex: number) => void
}

/**
 * 활성 탭이 아닐 때 보일 짧은 이름. "RFC 9110 · HTTP Semantics" 의 앞부분처럼
 * 가운뎃점 앞이 문서를 가려 주는 이름이라 그것만 남긴다. 가운뎃점이 없으면 그대로.
 */
export function shortTabTitle(title: string): string {
  const head = title.split(' · ')[0]?.trim() ?? ''
  return head === '' ? title : head
}

/** 끌기로 볼 만큼 움직였는지. 이보다 짧으면 클릭이다 */
const TAB_DRAG_THRESHOLD_PX = 6

function TabKindIcon({ kind }: { kind: Tab['kind'] }) {
  if (kind === 'note') return <Graph size={13} aria-hidden="true" className="pane-top-tab-kind" />
  if (kind === 'markdown') return <FileText size={13} aria-hidden="true" className="pane-top-tab-kind" />
  return <FilePdf size={13} aria-hidden="true" className="pane-top-tab-kind" />
}

/**
 * 탭 끌기. 같은 탭 줄 안에서는 끄는 대로 자리를 바꾸고(크롬처럼 탭이 바로 따라 옮겨 간다),
 * 반대편 패널(2단일 때) 위에 놓으면 그 패널로 옮긴다. HTML 끌어놓기는 Tauri 창(파일 끌어놓기를 가로챔)에서
 * 동작하지 않아 포인터 이벤트로 직접 한다. 놓은 자리의 data-pane-id 가 대상 패널이다.
 */
function startTabDrag(
  event: React.PointerEvent<HTMLElement>,
  tab: Tab,
  strip: HTMLElement | null,
  sourcePane: PaneId | undefined,
  onMoveTab: ((id: string, target: PaneId) => void) | undefined,
  onReorderTab: ((id: string, toIndex: number) => void) | undefined,
  suppressClick: () => void,
) {
  if (event.button !== 0) return
  const startX = event.clientX
  const startY = event.clientY
  let dragging = false
  let ghost: HTMLDivElement | null = null
  let target: HTMLElement | null = null
  const mark = (next: HTMLElement | null) => {
    if (target === next) return
    target?.classList.remove('pane-drop-target')
    target = next
    target?.classList.add('pane-drop-target')
  }
  const zoneAt = (x: number, y: number) => {
    if (sourcePane === undefined || onMoveTab === undefined) return null
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-id]') ?? null
    return zone !== null && zone.dataset.paneId !== sourcePane ? zone : null
  }
  const tabElements = () => Array.from(strip?.querySelectorAll<HTMLElement>('.pane-top-tab') ?? [])
  /** 같은 줄 안에서: 끄는 탭이 이웃 탭의 가운데를 넘으면 그 자리로 옮긴다 */
  const reorderAt = (x: number, y: number) => {
    if (onReorderTab === undefined || strip === null) return
    const rect = strip.getBoundingClientRect()
    // 탭 줄 위아래로 조금 벗어나도 순서 바꾸기로 본다(손이 살짝 내려가도 끊기지 않게)
    if (y < rect.top - 24 || y > rect.bottom + 24) return
    const elements = tabElements()
    const from = elements.findIndex((element) => element.dataset.tabId === tab.id)
    if (from < 0) return
    let to = from
    elements.forEach((element, index) => {
      const box = element.getBoundingClientRect()
      const mid = box.left + box.width / 2
      if (index > from && x > mid) to = index
      if (index < from && x < mid && to === from) to = index
    })
    if (to !== from) onReorderTab(tab.id, to)
  }
  const draggedElement = () => strip?.querySelector<HTMLElement>(`.pane-top-tab[data-tab-id="${CSS.escape(tab.id)}"]`) ?? null
  /** 끄는 탭이 손을 따라 가로로 움직인다. 자리(offsetLeft)가 바뀌어도 잡은 지점이 손 밑에 남는다 */
  const grabOffset = (() => {
    const element = draggedElement()
    return element === null ? 0 : startX - element.getBoundingClientRect().left
  })()
  const follow = (clientX: number) => {
    const element = draggedElement()
    if (element === null || strip === null) return
    const stripLeft = strip.getBoundingClientRect().left - strip.scrollLeft
    const slotLeft = stripLeft + element.offsetLeft
    const first = strip.querySelector<HTMLElement>('.pane-top-tab')
    const last = strip.querySelector<HTMLElement>('.pane-top-tab:last-child')
    // 탭 줄 양 끝 밖으로는 나가지 않는다
    const min = first === null ? -Infinity : stripLeft + first.offsetLeft - slotLeft
    const max = last === null ? Infinity : stripLeft + last.offsetLeft + last.offsetWidth - element.offsetWidth - slotLeft
    const x = Math.min(Math.max(clientX - grabOffset - slotLeft, min), max)
    element.dataset.dragX = String(x)
    element.style.transform = `translateX(${x}px)`
  }
  const move = (moveEvent: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < TAB_DRAG_THRESHOLD_PX) return
      dragging = true
      document.body.classList.add('pane-tab-dragging')
      draggedElement()?.classList.add('pane-top-tab-dragging')
    }
    const zone = zoneAt(moveEvent.clientX, moveEvent.clientY)
    if (zone !== null) {
      // 반대편 패널로 옮기려는 중: 탭 이름이 손을 따라온다
      if (ghost === null) {
        ghost = document.createElement('div')
        ghost.className = 'pane-tab-drag-ghost'
        ghost.textContent = tab.title
        document.body.appendChild(ghost)
      }
      ghost.style.transform = `translate(${moveEvent.clientX + 12}px, ${moveEvent.clientY + 10}px)`
    } else {
      ghost?.remove()
      ghost = null
      follow(moveEvent.clientX)
      reorderAt(moveEvent.clientX, moveEvent.clientY)
    }
    mark(zone)
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', cancel)
    mark(null)
    document.body.classList.remove('pane-tab-dragging')
    // 놓으면 제자리로 미끄러져 들어간다
    strip?.querySelectorAll<HTMLElement>('.pane-top-tab-dragging').forEach((element) => {
      element.classList.remove('pane-top-tab-dragging')
      delete element.dataset.dragX
      if (element.style.transform === '') return
      element.style.transition = 'transform 160ms ease'
      element.style.transform = ''
      window.setTimeout(() => { element.style.transition = '' }, 180)
    })
    ghost?.remove()
    ghost = null
  }
  const end = (endEvent: PointerEvent) => {
    const zone = dragging ? zoneAt(endEvent.clientX, endEvent.clientY) : null
    cleanup()
    if (!dragging) return
    suppressClick()
    const pane = zone?.dataset.paneId
    if ((pane === 'left' || pane === 'right' || pane === 'third' || pane === 'fourth') && onMoveTab !== undefined) onMoveTab(tab.id, pane)
  }
  const cancel = () => cleanup()
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', cancel)
}

/** 브라우저처럼 열린 항목마다 상단바에 탭 하나를 둔다. */
export function PaneTabsMenu({ state, label: rawLabel, onActivate, onClose, paneId, onMoveTab, moveTargets, focused = true, onDuplicateTab, onEditPages, onReorderTab }: PaneTabsMenuProps) {
  const label = t(rawLabel)
  const [menuOpen, setMenuOpen] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  // 탭이 줄에 다 들어가면 개수 단추(⌄ n)를 숨긴다. 넘칠 때만 보여 상단바를 조용하게 둔다
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const measure = () => setOverflowing(strip.scrollWidth > strip.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [state.tabs.length])
  // 끌기를 마친 직후 따라오는 click 은 탭 전환이 아니다.
  const suppressClickRef = useRef(false)
  const otherPane: PaneId | null = paneId === undefined ? null : paneId === 'left' ? 'right' : 'left'
  // 탭 우클릭 메뉴: 어느 탭에서, 화면 어디에 열렸나
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (contextMenu === null) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Node && document.querySelector('.pane-tab-context')?.contains(event.target)) return
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])
  const closeMany = (ids: readonly string[]) => {
    for (const id of ids) onClose(id)
    if (ids.length > 0) announceAction(t('탭 {count}개를 닫았습니다', { count: ids.length }))
  }
  const targets = moveTargets
    ?? (otherPane === null ? [] : [{ pane: otherPane, label: otherPane === 'right' ? t('오른쪽 패널로 옮기기') : t('왼쪽 패널로 옮기기') }])
  const firstTarget = targets[0] ?? null
  // 크롬처럼: × 로 탭을 닫으면 남은 탭의 폭을 그대로 묶어 둔다. 그러면 다음 탭의 × 가 마우스 밑으로 와서
  // 같은 자리를 연달아 눌러 여러 개를 닫을 수 있다. 마우스가 탭 줄을 벗어나면 폭을 다시 나눈다.
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null)
  const closeFromStrip = (element: HTMLElement | null, id: string) => {
    const width = element?.closest<HTMLElement>('.pane-top-tab')?.getBoundingClientRect().width ?? 0
    if (width > 0) setFrozenWidth(width)
    onClose(id)
    announceAction(t('{label}을 닫았습니다', { label }))
  }

  // 탭 순서가 바뀌면 이웃 탭이 새 자리로 미끄러진다(FLIP). 끄는 탭은 손 밑에 그대로 남긴다
  const slotsRef = useRef<Map<string, number>>(new Map())
  const tabOrder = state.tabs.map((tab) => tab.id).join(' ')
  useLayoutEffect(() => {
    const elements = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.pane-top-tab') ?? [])
    const previous = slotsRef.current
    const next = new Map<string, number>()
    for (const element of elements) {
      const id = element.dataset.tabId ?? ''
      next.set(id, element.offsetLeft)
      const before = previous.get(id)
      if (before === undefined || before === element.offsetLeft) continue
      const delta = before - element.offsetLeft
      if (element.dataset.dragX !== undefined) {
        const x = Number(element.dataset.dragX) + delta
        element.dataset.dragX = String(x)
        element.style.transform = `translateX(${x}px)`
        continue
      }
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue
      element.style.transition = 'none'
      element.style.transform = `translateX(${delta}px)`
      void element.offsetWidth
      element.style.transition = 'transform 160ms ease'
      element.style.transform = ''
      window.setTimeout(() => { if (element.dataset.dragX === undefined) element.style.transition = '' }, 180)
    }
    slotsRef.current = next
  }, [tabOrder])

  useEffect(() => {
    const active = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.pane-top-tab') ?? [])
      .find((element) => element.dataset.tabId === state.activeId)
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [state.activeId, state.tabs.length])

  if (state.tabs.length === 0) {
    return <span className="pane-tabs-empty">{t('열린 {label} 없음', { label })}</span>
  }

  return (
    <div
      className={`pane-tabs-menu${focused ? ' pane-tabs-focused' : ''}`}
      role="tablist"
      aria-label={t('열린 {label}', { label })}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <div ref={stripRef} className={`pane-tabs-strip${frozenWidth === null ? '' : ' pane-tabs-strip-frozen'}`} onPointerLeave={() => setFrozenWidth(null)} onWheel={(event) => {
        if (stripRef.current === null || stripRef.current.scrollWidth <= stripRef.current.clientWidth) return
        stripRef.current.scrollLeft += event.deltaY
      }}>
        {state.tabs.map((tab) => {
          const active = tab.id === state.activeId
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`pane-top-tab pane-top-tab-${tab.kind}${active ? ' pane-top-tab-active' : ''}`}
              style={frozenWidth === null ? undefined : { flex: '0 0 auto', width: `${frozenWidth}px`, minWidth: `${frozenWidth}px`, maxWidth: `${frozenWidth}px` }}
              // 가운데 단추(휠 클릭)로도 닫는다
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeFromStrip(event.currentTarget, tab.id)
              }}
              // 탭은 끌어서 패널을 옮기는 손잡이다. 상단바의 창 끌기로 넘어가지 않게 막는다.
              data-tauri-drag-region="false"
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenuOpen(false)
                setContextMenu({ id: tab.id, x: event.clientX, y: event.clientY })
              }}
              onPointerDown={onReorderTab === undefined && (paneId === undefined || onMoveTab === undefined) ? undefined : (event) => {
                if ((event.target as HTMLElement).closest('.pane-top-tab-close') !== null || event.button !== 0) return
                startTabDrag(event, tab, stripRef.current, paneId, onMoveTab, onReorderTab, () => {
                  suppressClickRef.current = true
                  window.setTimeout(() => { suppressClickRef.current = false }, 0)
                })
              }}
            >
              <button
                type="button"
                className="pane-top-tab-title"
                role="tab"
                aria-selected={active}
                title={tab.title}
                onClick={() => {
                  if (suppressClickRef.current) return
                  onActivate(tab.id)
                }}
              >
                <TabKindIcon kind={tab.kind} />
                <span className="pane-top-tab-label">{active ? tab.title : shortTabTitle(tab.title)}</span>
              </button>
              <button
                type="button"
                className="pane-top-tab-close"
                aria-label={t('{title} 닫기', { title: tab.title })}
                onClick={(event) => closeFromStrip(event.currentTarget, tab.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className={`pane-tabs-overflow${overflowing || menuOpen ? '' : ' pane-tabs-overflow-idle'}`}
        aria-label={t('열린 {label} 탭 목록 ({count}개)', { label, count: state.tabs.length })}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <CaretDown size={12} weight="bold" aria-hidden="true" />
        {/* 탭이 줄어 가려져도 몇 개가 열려 있는지는 여기서 본다 */}
        <span className="pane-tabs-count">{state.tabs.length}</span>
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            className="pane-tabs-backdrop"
            aria-label={t('{label} 탭 목록 닫기', { label })}
            onClick={() => setMenuOpen(false)}
          />
          <div className="pane-tabs-popover" role="menu" aria-label={t('열린 {label}', { label })}>
            {state.tabs.map((tab) => (
              <div
                key={tab.id}
                className={`pane-tabs-row${tab.id === state.activeId ? ' pane-tabs-row-active' : ''}`}
              >
                <button
                  type="button"
                  className="pane-tabs-item"
                  role="menuitem"
                  onClick={() => {
                    onActivate(tab.id)
                    setMenuOpen(false)
                  }}
                >
                  <span className="pane-tabs-check" aria-hidden="true">
                    {tab.id === state.activeId ? <Check size={13} aria-hidden="true" /> : null}
                  </span>
                  <span className="pane-tabs-item-title">{tab.title}</span>
                </button>
                {tab.kind === 'pdf' && onDuplicateTab !== undefined ? (
                  <button
                    type="button"
                    className="pane-tabs-close"
                    aria-label={t('{title} 한 군데 더 열기', { title: tab.title })}
                    title={t('같은 PDF 를 한 군데 더 열기')}
                    onClick={() => {
                      onDuplicateTab(tab.id)
                      announceAction(t('같은 PDF 를 한 군데 더 열었습니다'))
                      setMenuOpen(false)
                    }}
                  >
                    <CopySimple size={13} aria-hidden="true" />
                  </button>
                ) : null}
                {firstTarget !== null && onMoveTab !== undefined ? (
                  <button
                    type="button"
                    className="pane-tabs-close"
                    aria-label={`${tab.title} ${firstTarget.label}`}
                    title={firstTarget.label}
                    onClick={() => {
                      onMoveTab(tab.id, firstTarget.pane)
                      announceAction(firstTarget.label.replace(/옮기기.*$/u, '옮겼습니다') === firstTarget.label ? t('탭을 옮겼습니다') : firstTarget.label.replace(/옮기기.*$/u, '옮겼습니다'))
                      if (state.tabs.length === 1) setMenuOpen(false)
                    }}
                  >
                    <ArrowsLeftRight size={13} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pane-tabs-close"
                  aria-label={t('{title} 목록에서 닫기', { title: tab.title })}
                  onClick={() => {
                    onClose(tab.id)
                    announceAction(t('{label}을 닫았습니다', { label }))
                    if (state.tabs.length === 1) setMenuOpen(false)
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {contextMenu === null ? null : (() => {
        const index = state.tabs.findIndex((candidate) => candidate.id === contextMenu.id)
        const tab = state.tabs[index]
        if (tab === undefined) return null
        const others = state.tabs.filter((candidate) => candidate.id !== tab.id).map((candidate) => candidate.id)
        const toRight = state.tabs.slice(index + 1).map((candidate) => candidate.id)
        const run = (action: () => void) => () => {
          setContextMenu(null)
          action()
        }
        const left = Math.min(contextMenu.x, window.innerWidth - 230)
        return (
          <div className="pane-tab-context" role="menu" aria-label={t('{title} 탭 메뉴', { title: tab.title })} style={{ left, top: contextMenu.y + 4 }}>
            <button type="button" role="menuitem" onClick={run(() => closeMany([tab.id]))}>{t('닫기')}<kbd>Ctrl+W</kbd></button>
            <button type="button" role="menuitem" disabled={others.length === 0} onClick={run(() => closeMany(others))}>{t('다른 탭 모두 닫기')}</button>
            <button type="button" role="menuitem" disabled={toRight.length === 0} onClick={run(() => closeMany(toRight))}>{t('오른쪽 탭 모두 닫기')}</button>
            <button type="button" role="menuitem" onClick={run(() => closeMany(state.tabs.map((candidate) => candidate.id)))}>{t('모두 닫기')}</button>
            <div className="pane-tab-context-sep" role="separator" />
            {onMoveTab === undefined ? null : targets.map((target) => (
              <button key={target.pane} type="button" role="menuitem" onClick={run(() => onMoveTab(tab.id, target.pane))}>{target.label}</button>
            ))}
            {tab.kind === 'pdf' && onDuplicateTab !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onDuplicateTab(tab.id))}>{t('같은 PDF 한 군데 더 열기')}</button>
            ) : null}
            {tab.kind === 'pdf' && onEditPages !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onEditPages(tab.id))}>{t('쪽 편집 (순서·회전·끼워 넣기)…')}</button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={run(() => {
                void navigator.clipboard?.writeText(tab.title)
                announceAction(t('이름을 복사했습니다'))
              })}
            >
              {t('이름 복사')}
            </button>
          </div>
        )
      })()}
    </div>
  )
}
