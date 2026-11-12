import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLineRight, ArrowSquareIn, ArrowSquareOut, ArrowsLeftRight, Broom, CaretDown, Check, ClipboardText, CopySimple, FilePdf, Files, FileText, Graph, NotePencil, X, XSquare } from '@phosphor-icons/react'
import type { PaneId, Tab, TabsState } from './tabs'
import { ChannelDot } from './ChannelDot'
import type { PaneChannel } from './workspaceChannels'
import { announceAction } from './actionFeedback'
import { t } from '../i18n'
import { platformShortcut } from '../core/platform'
import { hasHiddenTabs, subFitsInTitle, tabsWithHiddenTitle } from './tabStripOverflow'
import { startTabDrag, reducedMotion, tabFlipSuppressed, type TabDragHost, type TearOffInfo } from './tabDrag'
import type { DockEdge } from './tabDock'
import { popIn, slideFrom } from './motion'
import { onTitleEditRequest, takeTitleEdit } from '../pdf/memoNoteContext'
import '../ui/tab-menu.css'
import '../ui/tab-drag.css'

interface PaneTabsMenuProps {
  state: TabsState
  /** 빈 창 닫기(창이 여럿일 때) */
  onClosePane?: () => void
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
  /** PDF 탭을 별도 창으로 떼어 낸다 */
  onDetachTab?: (id: string) => void
  /** 떼어 낸 창에서: 탭을 메인 창으로 되돌리고 이 창을 닫는다 */
  onReattach?: () => void
  /** 탭을 끌어 같은 줄의 toIndex 자리로 옮긴다 */
  onReorderTab?: (id: string, toIndex: number) => void
  /** 탭을 다른 패널의 index 자리로 옮긴다(끌어서 다른 패널의 탭 줄·본문에 놓았을 때) */
  onMoveTabAt?: (id: string, target: PaneId, index: number) => void
  /** 탭을 패널의 edge 쪽을 갈라 새 패널로(끌어서 가장자리에 놓았을 때) */
  onDockTab?: (id: string, target: PaneId, edge: DockEdge) => void
  /** 그 패널에서 나눌 수 있는 가장자리들 */
  dockEdges?: (target: PaneId, id: string) => readonly DockEdge[]
  /** 창 밖으로 끌어낸 탭을 새 창으로 떼어 낸다. true 면 이어 받았다 */
  onTearOffTab?: (id: string, info: TearOffInfo) => Promise<boolean> | boolean
  /** 이 창에 탭이 이것뿐인 떼어 낸 창: 탭을 끌면 창 전체가 따라간다 */
  dragWindow?: boolean
  /** 이 창의 색 채널. onCycleChannel 을 함께 주면 탭 줄 맨 앞에 색 점이 보인다(눌러서 바꾸기) */
  channel?: PaneChannel
  onCycleChannel?: () => void
  /** 미리보기 탭을 보통 탭으로 고정한다(탭을 두 번 눌렀을 때) */
  onPinTab?: (id: string) => void
  /** 칸 번호(왼쪽 위부터 0). 색 점 바로 뒤에 작은 숫자로 보인다 */
  paneNumber?: number
  /** 보는 탭의 제목 바로 뒤에 「·」 로 이어 흐리게 보일 보조 글(PDF 는 쪽, 노트는 폴더, MD 는 경로). 보는 탭에만 붙는다 */
  secondary?: string | null
  /** 보는 탭의 제목 뒤에 붙일 것(메모 노트의 「노트 열기」 ⌄ 단추). 보는 탭에만 붙는다 */
  renderTabExtra?: (tab: Tab) => ReactNode
  /** 탭 이름을 그 자리에서 바꾼다(제목을 두 번 누르면). 주면 그 탭 종류에서만 바꾸기가 켜진다 */
  onRenameTab?: (tab: Tab, title: string) => void
  /** 이름 바꾸기를 지원하는 탭인가(기본: 지원 안 함) */
  canRenameTab?: (tab: Tab) => boolean
}

/**
 * 활성 탭이 아닐 때 보일 짧은 이름. "RFC 9110 · HTTP Semantics" 의 앞부분처럼
 * 가운뎃점 앞이 문서를 가려 주는 이름이라 그것만 남긴다. 가운뎃점이 없으면 그대로.
 */
export function shortTabTitle(title: string): string {
  const head = title.split(' · ')[0]?.trim() ?? ''
  return head === '' ? title : head
}

function TabKindIcon({ kind }: { kind: Tab['kind'] }) {
  if (kind === 'memoNote') return <NotePencil size={13} aria-hidden="true" className="pane-top-tab-kind" />
  if (kind === 'canvas') return <Graph size={13} aria-hidden="true" className="pane-top-tab-kind" />
  if (kind === 'markdown') return <FileText size={13} aria-hidden="true" className="pane-top-tab-kind" />
  return <FilePdf size={13} aria-hidden="true" className="pane-top-tab-kind" />
}

/** 브라우저처럼 열린 항목마다 상단바에 탭 하나를 둔다. */
export function PaneTabsMenu({ state, label: rawLabel, onActivate, onClose, paneId, onMoveTab, moveTargets, focused = true, onDuplicateTab, onEditPages, onDetachTab, onReattach, onReorderTab, onMoveTabAt, onDockTab, dockEdges, onTearOffTab, dragWindow, onClosePane, channel = null, onCycleChannel, onPinTab, paneNumber, secondary = null, renderTabExtra, onRenameTab, canRenameTab }: PaneTabsMenuProps) {
  const channelDot = onCycleChannel === undefined ? null : (
    <>
      <ChannelDot channel={channel} onCycle={onCycleChannel} />
      {paneNumber === undefined ? null : <span className="pane-head-number" title={t('칸 {n}', { n: paneNumber })}>{paneNumber}</span>}
    </>
  )
  const label = t(rawLabel)
  // 탭 제목을 그 자리에서 바꾸는 중인 탭(두 번 눌러서, 또는 새 노트를 막 만들어서)
  const [renaming, setRenaming] = useState<string | null>(null)
  const shownTab = state.tabs.find((tab) => tab.id === state.activeId)
  const shownRenamable = shownTab !== undefined && onRenameTab !== undefined && canRenameTab?.(shownTab) === true
  const shownId = shownTab?.id ?? null
  // 노트를 막 만들었으면(새 노트 · 이 PDF 에 노트 만들기) 이름 칸을 바로 연다
  useEffect(() => {
    if (!shownRenamable || shownId === null) return undefined
    const check = () => { if (takeTitleEdit(shownId)) setRenaming(shownId) }
    check()
    return onTitleEditRequest(check)
  }, [shownRenamable, shownId])
  const finishRename = (tab: Tab, value: string) => {
    setRenaming(null)
    const next = value.trim()
    if (next !== '' && next !== tab.title) onRenameTab?.(tab, next)
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const overflowRef = useRef<HTMLButtonElement>(null)
  // 열린 탭 목록: 열리면 첫 항목으로 초점(방향키로 고른다), Esc 로 닫으면 목록 단추로 돌아간다
  useEffect(() => {
    if (!menuOpen) return
    document.querySelector<HTMLElement>('.pane-tabs-popover [role="menuitem"]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      window.setTimeout(() => {
        overflowRef.current?.focus()
        // 탭이 다 보일 때는 목록 단추가 숨겨져 있다: 현재 탭으로 돌려보낸다
        if (document.activeElement !== overflowRef.current) stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  const stripRef = useRef<HTMLDivElement>(null)
  // 탭이 줄에 다 들어가면 개수 단추(⌄ n)를 숨긴다. 넘칠 때만 보여 상단바를 조용하게 둔다
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const measure = () => setOverflowing(hasHiddenTabs(strip))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [state.tabs.length])
  // 보조 글(쪽 · 폴더 · 경로)은 제목이 통째로 보이고 보조 글도 통째로 들어갈 때만 보인다. 모자라면 「·」 도 글자도 아예 감춘다(「설... · p」 처럼 잘려 보이지 않게)
  const [subFits, setSubFits] = useState(true)
  const subKey = secondary ?? ''
  const activeTitle = state.tabs.find((tab) => tab.id === state.activeId)?.title ?? ''
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null || subKey === '') return undefined
    const check = () => setSubFits(subFitsInTitle(strip.querySelector<HTMLElement>('.pane-top-tab-active .pane-top-tab-title')))
    check()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(check)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [subKey, activeTitle, state.activeId, state.tabs.length])
  // 이름이 잘렸거나 아이콘만 남은 탭에만 말풍선(title)을 단다: 이름이 다 보이는 탭에는 같은 이름의 말풍선이 또 뜨지 않게
  const [hiddenTitles, setHiddenTitles] = useState('')
  const titlesKey = state.tabs.map((tab) => `${tab.id}${tab.title}`).join('')
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (strip === null) return undefined
    const measure = () => setHiddenTitles(tabsWithHiddenTitle(strip).join(''))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [titlesKey, state.activeId, subKey, subFits, renaming])
  // 끌기가 시작된 때부터 놓은 뒤 따라오는 click 까지는 탭 전환이 아니다(고정 시간이 아니다: 오래 끌다 Esc 로 취소하고 탭 위에서 놓아도 click 이 막혀야 한다).
  // 놓은 뒤(pointerup) click 이 지나가도록 한 틱 미루어 풀고, 새로 누르면(pointerdown) 바로 푼다 — 창이 따로 움직여 pointerup 이 안 오는 끌기도 갇히지 않게
  const suppressClickRef = useRef(false)
  const clearSuppressRef = useRef<(() => void) | null>(null)
  const armClickSuppress = () => {
    clearSuppressRef.current?.()
    suppressClickRef.current = true
    let timer: number | null = null
    const release = () => {
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('pointerdown', release, true)
      if (timer !== null) window.clearTimeout(timer)
      suppressClickRef.current = false
      if (clearSuppressRef.current === release) clearSuppressRef.current = null
    }
    const onUp = () => { timer = window.setTimeout(release, 0) }
    clearSuppressRef.current = release
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('pointerdown', release, true)
  }
  useEffect(() => () => clearSuppressRef.current?.(), [])
  // 끄는 동안 다시 그려져도 최신 값을 읽도록 ref 로 둔다
  const dragHostRef = useRef<(tab: Tab) => TabDragHost>(() => { throw new Error('unset') })
  dragHostRef.current = (tab) => ({
    tab,
    sourcePane: paneId,
    reorder: onReorderTab,
    moveAt: onMoveTabAt ?? (onMoveTab === undefined ? undefined : (id, pane) => onMoveTab(id, pane)),
    dock: onDockTab,
    dockEdges,
    dragWindow: dragWindow === true && state.tabs.length === 1 && tab.kind === 'pdf',
    tearOff: onTearOffTab === undefined || tab.kind !== 'pdf' ? undefined : (id, info) => onTearOffTab(id, info),
    onDragged: armClickSuppress,
  })
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
  const targets = moveTargets ?? []
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

  // 탭 순서가 바뀌면 이웃 탭이 새 자리로 미끄러지고(FLIP), 새로 생긴 탭은 부드럽게 나타난다.
  // 끄는 탭은 구멍이라 보이지 않고, 놓아서 옮긴 순간에는(이미 손이 만든 자리라) 미끄러지지 않는다
  const slotsRef = useRef<Map<string, number>>(new Map())
  const mountedRef = useRef(false)
  const tabOrder = state.tabs.map((tab) => tab.id).join(' ')
  useLayoutEffect(() => {
    const elements = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.pane-top-tab') ?? [])
    const previous = slotsRef.current
    const next = new Map<string, number>()
    const quiet = tabFlipSuppressed() || reducedMotion() || typeof HTMLElement.prototype.animate !== 'function'
    for (const element of elements) {
      const id = element.dataset.tabId ?? ''
      next.set(id, element.offsetLeft)
      const before = previous.get(id)
      if (before === undefined) {
        if (mountedRef.current && !quiet) {
          popIn(element, 'translateY(7px) scale(0.92)')
        }
        continue
      }
      if (before === element.offsetLeft || quiet) continue
      slideFrom(element, 'x', before - element.offsetLeft)
    }
    mountedRef.current = true
    slotsRef.current = next
  }, [tabOrder])

  useEffect(() => {
    const active = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.pane-top-tab') ?? [])
      .find((element) => element.dataset.tabId === state.activeId)
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [state.activeId, state.tabs.length])

  if (state.tabs.length === 0) {
    return (
      <span className="pane-tabs-empty-row" role="group" aria-label={t('열린 {label} 없음', { label })}>
        {channelDot}
        {onClosePane === undefined ? null : (
          <button type="button" className="pane-close-button" aria-label={t('이 창 닫기')} title={t('이 창 닫기')} onClick={onClosePane}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </span>
    )
  }

  return (
    <div
      className={`pane-tabs-menu${focused ? ' pane-tabs-focused' : ''}${state.tabs.length === 1 ? ' pane-tabs-single' : ''}`}
      role="tablist"
      aria-label={t('열린 {label}', { label })}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      {channelDot}
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
              className={`pane-top-tab pane-top-tab-${tab.kind}${active ? ' pane-top-tab-active' : ''}${tab.preview === true ? ' pane-top-tab-preview' : ''}`}
              data-preview={tab.preview === true ? '' : undefined}
              // 미리보기 탭은 두 번 누르면 보통 탭으로 고정된다
              onDoubleClick={() => { if (tab.preview === true) onPinTab?.(tab.id) }}
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
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('.pane-top-tab-close') !== null || event.button !== 0) return
                // 누르는 순간에는 아무것도 바꾸지 않는다: 안 보이는 탭을 끌어도 보이는 탭 · 만지는 칸 · 상단바 도구줄이 바뀌지 않는다.
                // 탭이 보이는 탭이 되고 칸이 만지는 칸이 되는 것은 놓을 때(onClick)다 — 끌었으면 click 이 막혀 아무것도 바뀌지 않는다
                startTabDrag(event, event.currentTarget, () => dragHostRef.current(tab))
              }}
            >
              {renaming === tab.id ? (
                <div className="pane-top-tab-title pane-top-tab-renaming">
                  <TabKindIcon kind={tab.kind} />
                  <input
                    className="pane-top-tab-rename"
                    aria-label={t('노트 이름')}
                    defaultValue={tab.title}
                    autoFocus
                    spellCheck={false}
                    data-prefix-off=""
                    onFocus={(event) => event.currentTarget.select()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={(event) => finishRename(tab, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      else if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null) }
                    }}
                  />
                </div>
              ) : (
              <button
                type="button"
                className="pane-top-tab-title"
                role="tab"
                aria-selected={active}
                tabIndex={active || (state.activeId === null && tab === state.tabs[0]) ? 0 : -1}
                title={hiddenTitles.split('').includes(tab.id) ? (canRenameTab?.(tab) === true ? t('{title} · 두 번 눌러 이름 바꾸기', { title: tab.title }) : tab.title) : undefined}
                onDoubleClick={onRenameTab !== undefined && canRenameTab?.(tab) === true ? () => setRenaming(tab.id) : undefined}
                onKeyDown={(event) => {
                  // 탭 줄 방향키: ←→ 이웃 탭(자동으로 보이게), Home·End 처음·끝
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
                  const buttons = [...(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
                  const here = buttons.indexOf(event.currentTarget)
                  if (here < 0) return
                  event.preventDefault()
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (here + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
                  buttons[next]?.focus()
                  const nextTab = state.tabs[next]
                  if (nextTab !== undefined && nextTab.id !== state.activeId) onActivate(nextTab.id)
                }}
                onClick={() => {
                  if (suppressClickRef.current) return
                  onActivate(tab.id)
                }}
              >
                <TabKindIcon kind={tab.kind} />
                <span className="pane-top-tab-label">{active ? tab.title : shortTabTitle(tab.title)}</span>
                {/* 흐린 보조 글: 보는 탭의 제목 바로 뒤에 「·」 로 이어 붙는다(안 보이는 탭에는 없다) */}
                {active && secondary !== null && secondary !== '' ? (
                  <>
                    <span className={`pane-top-tab-sep${subFits ? '' : ' pane-top-tab-aux-off'}`} aria-hidden="true">·</span>
                    <span className={`pane-top-tab-sub${subFits ? '' : ' pane-top-tab-aux-off'}`} aria-hidden="true" title={secondary}>{secondary}</span>
                  </>
                ) : null}
                {/* 상태 점: 미리보기 탭일 때만(고치면 고정되어 사라진다) */}
                {tab.preview === true ? <span className="pane-top-tab-dot" title={t('미리보기 탭')} aria-hidden="true" /> : null}
              </button>
              )}
              {active && renaming !== tab.id && renderTabExtra !== undefined ? renderTabExtra(tab) : null}
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
        ref={overflowRef}
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
          <div
            className="pane-tab-context"
            role="menu"
            aria-label={t('{title} 탭 메뉴', { title: tab.title })}
            style={{ left, top: contextMenu.y + 4 }}
            // 열리면 첫 항목에 초점을 두어 ↑↓·Escape 가 듣게 한다(마우스로 열면 칠하지는 않는다)
            ref={(element) => {
              if (element !== null && !element.contains(document.activeElement)) element.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true })
            }}
            onKeyDown={(event) => {
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'))
              const at = items.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === 'ArrowDown' ? (at + 1) % items.length
                : event.key === 'ArrowUp' ? (at <= 0 ? items.length - 1 : at - 1)
                  : event.key === 'Home' ? 0
                    : event.key === 'End' ? items.length - 1
                      : null
              if (next === null || items.length === 0) return
              event.preventDefault()
              items[next]?.focus()
            }}
          >
            <button type="button" role="menuitem" onClick={run(() => closeMany([tab.id]))}>
              <X size={15} aria-hidden="true" /><span>{t('닫기')}</span><kbd>{platformShortcut('Ctrl+W')}</kbd>
            </button>
            <button type="button" role="menuitem" disabled={others.length === 0} onClick={run(() => closeMany(others))}>
              <XSquare size={15} aria-hidden="true" /><span>{t('다른 탭 모두 닫기')}</span>
            </button>
            <button type="button" role="menuitem" disabled={toRight.length === 0} onClick={run(() => closeMany(toRight))}>
              <ArrowLineRight size={15} aria-hidden="true" /><span>{t('오른쪽 탭 모두 닫기')}</span>
            </button>
            <button type="button" role="menuitem" onClick={run(() => closeMany(state.tabs.map((candidate) => candidate.id)))}>
              <Broom size={15} aria-hidden="true" /><span>{t('모두 닫기')}</span>
            </button>
            {(onMoveTab !== undefined && targets.length > 0) || (tab.kind === 'pdf' && onDuplicateTab !== undefined) ? (
              <div className="pane-tab-context-sep" role="separator" />
            ) : null}
            {onMoveTab === undefined ? null : targets.map((target) => (
              <button key={target.pane} type="button" role="menuitem" onClick={run(() => onMoveTab(tab.id, target.pane))}>
                <ArrowsLeftRight size={15} aria-hidden="true" /><span>{target.label}</span>
              </button>
            ))}
            {tab.kind === 'pdf' && onDuplicateTab !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onDuplicateTab(tab.id))}>
                <CopySimple size={15} aria-hidden="true" /><span>{t('같은 PDF 하나 더 열기')}</span>
              </button>
            ) : null}
            <div className="pane-tab-context-sep" role="separator" />
            {tab.kind === 'pdf' && onDetachTab !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onDetachTab(tab.id))}>
                <ArrowSquareOut size={15} aria-hidden="true" /><span>{t('창으로 떼어 내기')}</span>
              </button>
            ) : null}
            {onReattach === undefined ? null : (
              <button type="button" role="menuitem" onClick={run(onReattach)}>
                <ArrowSquareIn size={15} aria-hidden="true" /><span>{t('다시 붙이기')}</span>
              </button>
            )}
            {tab.kind === 'pdf' && onEditPages !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onEditPages(tab.id))}>
                <Files size={15} aria-hidden="true" /><span>{t('쪽 편집 (순서·회전·끼워 넣기)…')}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={run(() => {
                void navigator.clipboard?.writeText(tab.title)
                announceAction(t('이름을 복사했습니다'))
              })}
            >
              <ClipboardText size={15} aria-hidden="true" /><span>{t('이름 복사')}</span>
            </button>
          </div>
        )
      })()}
    </div>
  )
}
