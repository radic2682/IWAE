import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  CaretDown, Command,
  ImagesSquare, MagnifyingGlass,
  ListBullets,
  SidebarSimple,
  TreeStructure,
  Toolbox,
} from '@phosphor-icons/react'
import { closeWindow } from '../bridge/window'
import { WindowControls } from './WindowControls'
import { AppMenu, type AppMenuGroups } from './AppMenu'
import { SessionMenu, type SessionMenuActions } from './SessionMenu'
import { ScreenTabs, type ScreenTabItem, type ScreenTemplateItem } from './ScreenTabs'
import { isMacPlatform } from '../core/platform'
import '../ui/screens.css'
import { t } from '../i18n'

export type SidebarMode = 'library' | 'thumbnails' | 'outline' | 'tools' | 'search'

interface TopBarProps {
  sidebarCollapsed: boolean
  sidebarVisible?: boolean
  onToggleSidebar: () => void
  sidebarMode: SidebarMode
  onSidebarModeChange: (mode: SidebarMode) => void
  sidebarPx: number
  onCloseWindow?: () => void
  /** 로고 메뉴의 항목들(인쇄·화면·설정 …). 주면 맨 왼쪽에 로고 메뉴 단추가 나온다 */
  appMenu?: AppMenuGroups
  /** 사이드바 접기·펴기 단추를 숨긴다(왼쪽 바가 없는 떼어 낸 창) */
  hideSidebarToggle?: boolean
  /** 세션 이름(「세션 이름 ▾」 단추) */
  sessionName?: string
  /** 세션 메뉴의 동작들. 없으면(떼어 낸 창 · 새 창) 메뉴는 이름만 보이고 열리지 않는다 */
  sessionActions?: SessionMenuActions
  /** 화면 탭(0 읽기 · 1 비교 …). 없으면(떼어 낸 창) 화면 줄을 그리지 않는다 */
  screens?: {
    readonly items: readonly ScreenTabItem[]
    readonly activeId: string
    readonly lastId: string | null
    readonly templates: readonly ScreenTemplateItem[]
    readonly onSelect: (id: string) => void
    readonly onRename: (id: string, name: string) => void
    readonly onReorder: (id: string, toIndex: number) => void
    readonly onClose: (id: string) => void
    readonly onNew: (templateId: string) => void
  }
  /** 「⌘ 명령」 단추: 명령 팔레트를 연다. shortcut 은 단추 말풍선에 보일 키 */
  onOpenPalette?: () => void
  paletteShortcut?: string
}

/**
 * 프레임리스 제목줄(설계 3): 앱 메뉴 · 왼쪽 바 · 세션 이름 ▾ · 화면 탭 · ⌘ 명령 · 창 단추.
 * 문서 탭은 여기 없다 — 칸마다 자기 머리(PaneHead)에 있다. 「창 나누기」 · 「옆에 노트」 단추도 없다(칸 ⋯ 메뉴와 명령 팔레트로 옮겼다).
 */
export function TopBar({
  sidebarCollapsed,
  sidebarVisible = true,
  onToggleSidebar,
  sidebarMode,
  onSidebarModeChange,
  onCloseWindow = closeWindow,
  appMenu,
  hideSidebarToggle = false,
  sessionName = t('기본'),
  sessionActions,
  screens,
  onOpenPalette,
  paletteShortcut,
}: TopBarProps) {
  const [sessionMenu, setSessionMenu] = useState<{ left: number; top: number } | null>(null)
  const sessionRef = useRef<HTMLButtonElement | null>(null)
  // 접두키 + s: 세션 메뉴를 연다
  useEffect(() => {
    const open = () => {
      const box = sessionRef.current?.getBoundingClientRect()
      setSessionMenu({ left: box?.left ?? 0, top: (box?.bottom ?? 0) + 4 })
    }
    window.addEventListener('iwae:open-session-menu', open)
    return () => window.removeEventListener('iwae:open-session-menu', open)
  }, [])
  // 왼쪽 위 단추 묶음의 실제 폭. 사이드바가 이보다 좁으면 묶음이 첫 탭(왼쪽 모서리·곡선)을 덮었다 — 그만큼 탭을 민다
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const [actionsWidth, setActionsWidth] = useState<number | null>(null)
  useEffect(() => {
    const element = actionsRef.current
    if (element === null) return
    const measure = () => setActionsWidth(Math.ceil(element.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // 오른쪽 창 단추 묶음(창 나누기·옆에 노트·창 단추)의 폭. 맨 오른쪽 탭 줄이 그만큼 비워 둔다
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [windowToolsWidth, setWindowToolsWidth] = useState<number | null>(null)
  useEffect(() => {
    const element = rootRef.current?.querySelector('.wincontrols')
    if (element == null) return
    const measure = () => setWindowToolsWidth(Math.ceil(element.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const widthVars: Record<string, string> = {}
  if (actionsWidth !== null && actionsWidth > 0) widthVars['--topbar-actions-w'] = `${actionsWidth}px`
  if (windowToolsWidth !== null && windowToolsWidth > 0) widthVars['--topbar-wincontrols-w'] = `${windowToolsWidth}px`
  return (
    <div
      ref={rootRef}
      className={`topbar${sidebarCollapsed ? ' topbar-sidebar-collapsed' : ''}${sidebarCollapsed || !sidebarVisible ? ' topbar-sidebar-unreserved' : ''}${isMacPlatform() ? ' topbar-mac' : ''}`}
      style={Object.keys(widthVars).length === 0 ? undefined : widthVars as CSSProperties}
      data-tauri-drag-region="deep"
    >
      <div className="topbar-leftcluster">
        <div className="topbar-leftcluster-actions" ref={actionsRef}>
        {appMenu === undefined ? null : <AppMenu groups={appMenu} />}
        {hideSidebarToggle ? null : (
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? t('사이드바 펼치기') : t('사이드바 접기')}
            aria-expanded={!sidebarCollapsed}
            onClick={onToggleSidebar}
          >
            <SidebarSimple size={15} weight={sidebarCollapsed ? 'regular' : 'fill'} aria-hidden="true" />
          </button>
        )}

        {sidebarCollapsed || !sidebarVisible ? null : (
          // 사이드바 보기는 사이드바 바로 위에 탭으로 단다. 고른 탭이 아래 사이드바와 이어진다
          <div className="topbar-nav topbar-side-tabs" role="radiogroup" aria-label={t('사이드바 보기')}>
            <button type="button" className={`topbar-navbtn${sidebarMode === 'library' ? ' topbar-navbtn-active' : ''}`} aria-label={t('탐색기')} title={t('탐색기')} role="radio" aria-checked={sidebarMode === 'library'} onClick={() => onSidebarModeChange('library')}>
              <TreeStructure size={15} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className={`topbar-navbtn${sidebarMode === 'outline' ? ' topbar-navbtn-active' : ''}`} aria-label={t('목록')} title={t('목록')} role="radio" aria-checked={sidebarMode === 'outline'} onClick={() => onSidebarModeChange('outline')}>
              <ListBullets size={15} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className={`topbar-navbtn${sidebarMode === 'thumbnails' ? ' topbar-navbtn-active' : ''}`} aria-label={t('미리보기')} title={t('미리보기')} role="radio" aria-checked={sidebarMode === 'thumbnails'} onClick={() => onSidebarModeChange('thumbnails')}>
              <ImagesSquare size={15} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className={`topbar-navbtn${sidebarMode === 'tools' ? ' topbar-navbtn-active' : ''}`} aria-label={t('PDF 도구')} title={t('PDF 도구')} role="radio" aria-checked={sidebarMode === 'tools'} onClick={() => onSidebarModeChange('tools')}>
              <Toolbox size={15} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" className={`topbar-navbtn${sidebarMode === 'search' ? ' topbar-navbtn-active' : ''}`} aria-label={t('PDF 검색')} title={t('PDF 검색 (Ctrl+F)')} role="radio" aria-checked={sidebarMode === 'search'} onClick={() => onSidebarModeChange('search')}>
              <MagnifyingGlass size={15} weight="regular" aria-hidden="true" />
            </button>
          </div>
        )}
        </div>
      </div>

      {/* "deep" 이어야 한다. 값 없는 속성은 이 div 자체를 눌렀을 때만 드래그로 치고,
          그 안의 빈 칸을 누르면 바깥 .topbar 의 deep 까지 올라가기 전에 막아 버린다. */}
      <div className="topbar-session-row" data-tauri-drag-region="deep">
        <button
          ref={sessionRef}
          type="button"
          className="topbar-session"
          aria-haspopup="menu"
          aria-expanded={sessionMenu !== null}
          title={t('세션')}
          data-tauri-drag-region="false"
          disabled={sessionActions === undefined}
          onClick={() => {
            if (sessionMenu !== null) { setSessionMenu(null); return }
            const box = sessionRef.current?.getBoundingClientRect()
            setSessionMenu({ left: box?.left ?? 0, top: (box?.bottom ?? 0) + 4 })
          }}
        >
          <span className="topbar-session-name">{sessionName}</span>
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </button>
        {sessionMenu !== null && sessionActions !== undefined ? (
          <SessionMenu
            current={sessionName}
            left={sessionMenu.left}
            top={sessionMenu.top}
            anchorRef={sessionRef}
            actions={sessionActions}
            onClose={(restore) => { setSessionMenu(null); if (restore) sessionRef.current?.focus() }}
          />
        ) : null}
        {screens === undefined ? null : (
          <ScreenTabs
            screens={screens.items}
            activeId={screens.activeId}
            lastId={screens.lastId}
            templates={screens.templates}
            onSelect={screens.onSelect}
            onRename={screens.onRename}
            onReorder={screens.onReorder}
            onClose={screens.onClose}
            onNew={screens.onNew}
          />
        )}
      </div>

      <WindowControls
        onCloseWindow={onCloseWindow}
        leading={onOpenPalette === undefined ? undefined : (
          // 앱 전체에 관한 단추(명령)는 창 단추 곁에 둔다
          <div className="topbar-window-tools">
            <button
              type="button"
              className="topbar-command"
              aria-label={t('명령 팔레트')}
              title={paletteShortcut === undefined ? t('명령 팔레트') : t('명령 팔레트 ({shortcut})', { shortcut: paletteShortcut })}
              onClick={onOpenPalette}
            >
              <Command size={13} aria-hidden="true" />
              <span>{paletteShortcut === undefined ? t('명령') : t('명령 ({shortcut})', { shortcut: paletteShortcut })}</span>
            </button>
          </div>
        )}
      />
    </div>
  )
}
