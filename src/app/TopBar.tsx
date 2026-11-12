import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ImagesSquare, MagnifyingGlass,
  ListBullets,
  SidebarSimple,
  TreeStructure,
  Toolbox,
} from '@phosphor-icons/react'
import { closeWindow } from '../bridge/window'
import { WindowControls } from './WindowControls'
import { PdfSplitPicker } from './PdfLayoutControls'
import type { PdfSplitLayoutId } from '../core/pdfSplit'
import type { LayoutPresetDef, LayoutPresetId } from './layoutPresets'
import { AppMenu, type AppMenuGroups } from './AppMenu'
import { MemoPanelIcon } from '../pdf/MemoPanelIcon'
import { isMacPlatform } from '../core/platform'
import { t } from '../i18n'

export type SidebarMode = 'library' | 'thumbnails' | 'outline' | 'tools' | 'search'

interface TopBarProps {
  sidebarCollapsed: boolean
  sidebarVisible?: boolean
  onToggleSidebar: () => void
  sidebarMode: SidebarMode
  onSidebarModeChange: (mode: SidebarMode) => void
  sidebarPx: number
  leftFrac: number
  /** 칸이 하나일 때 그 칸의 탭 줄(둘 이상이면 탭 줄은 칸마다 칸 안에 있어 null) */
  leftTabs: ReactNode
  /** leftTabs 가 놓이는 칸의 id(탭을 끌어 놓는 자리를 찾는 데 쓴다) */
  leftPaneId?: string
  onCloseWindow?: () => void
  /** 문서 검색 화면인가. 단추가 눌린 모양이 된다 */
  docSearchActive?: boolean
  /** 1단 보기인가(탭 줄 배치용) */
  singlePane?: boolean
  /** 창 나누기 배치(예전 배치 중 하나와 같은 모양이면 그 id, 직접 나눈 모양이면 null). onPaneLayoutChange 가 있으면 배치 고르는 단추가 나온다 */
  paneLayout?: PdfSplitLayoutId | null
  onPaneLayoutChange?: (layout: PdfSplitLayoutId) => void
  /** 로고 메뉴의 항목들(인쇄·화면·설정 …). 주면 맨 왼쪽에 로고 메뉴 단추가 나온다 */
  appMenu?: AppMenuGroups
  /** 사이드바 접기·펴기 단추를 숨긴다(왼쪽 바가 없는 떼어 낸 창) */
  hideSidebarToggle?: boolean
  /** 「옆에 노트 열기 / 닫기」: 보는 문서 옆에 메모 노트 창을 열고 닫는다. shown 은 같은 색 창에 노트가 보이는가. 문서를 볼 때만 준다 */
  noteBeside?: { readonly shown: boolean; readonly onToggle: () => void }
  /** 이름 붙은 배치(읽기·노트 왼쪽·비교·정리). 주면 창 나누기 목록 아래에 「배치」가 나온다 */
  layoutPresets?: { readonly presets: readonly LayoutPresetDef[]; readonly onApply: (id: LayoutPresetId) => void }
}

/** 창 조작과 열린 문서 탭을 한 줄에 놓는 프레임리스 제목줄이다. */
export function TopBar({
  sidebarCollapsed,
  sidebarVisible = true,
  onToggleSidebar,
  sidebarMode,
  onSidebarModeChange,
  leftFrac,
  leftTabs,
  leftPaneId,
  onCloseWindow = closeWindow,
  singlePane = false,
  paneLayout = 'single',
  onPaneLayoutChange,
  appMenu,
  noteBeside,
  layoutPresets,
  hideSidebarToggle = false,
}: TopBarProps) {
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
      className={`topbar${singlePane ? ' topbar-single' : ''}${sidebarCollapsed ? ' topbar-sidebar-collapsed' : ''}${sidebarCollapsed || !sidebarVisible ? ' topbar-sidebar-unreserved' : ''}${isMacPlatform() ? ' topbar-mac' : ''}`}
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
          그 안의 탭 줄·빈 칸을 누르면 바깥 .topbar 의 deep 까지 올라가기 전에 막아 버린다. */}
      <div className="topbar-panetabs" data-tauri-drag-region="deep">
        {leftTabs === null || leftTabs === undefined ? null : (
          <>
            <div className="topbar-panetab-zone" data-pane-id={leftPaneId} style={{ flexGrow: leftFrac }}>{leftTabs}</div>
            <div className="topbar-pane-divider" aria-hidden="true" />
            {/* 오른쪽 창 단추 묶음이 차지하는 자리 */}
            <div className="topbar-panetab-zone topbar-panetab-zone-right" style={{ flexGrow: 1 - leftFrac }} />
          </>
        )}
      </div>

      <WindowControls
        onCloseWindow={onCloseWindow}
        leading={(
          // 창 전체에 관한 단추(창 나누기·옆에 노트)는 창 단추 곁에 둔다
          <div className="topbar-window-tools">
            {onPaneLayoutChange === undefined ? null : (
              <PdfSplitPicker
                value={paneLayout}
                onChange={onPaneLayoutChange}
                label={t('창 나누기')}
                head={t('창 나누기 · 다른 문서를 나란히 봅니다')}
                align="right"
                buttonClassName="topbar-navbtn topbar-panecount-cycle"
                activeClassName="topbar-navbtn-active"
                shortcut={t('(Ctrl+\\ 로 차례로)')}
                presets={layoutPresets}
              />
            )}
            {noteBeside === undefined ? null : (
              <button
                type="button"
                className={`topbar-navbtn topbar-memo-toggle${noteBeside.shown ? ' topbar-navbtn-active' : ''}`}
                aria-label={noteBeside.shown ? t('옆에 노트 닫기') : t('옆에 노트 열기')}
                aria-pressed={noteBeside.shown}
                title={noteBeside.shown ? t('옆에 노트 닫기') : t('옆에 노트 열기')}
                onClick={noteBeside.onToggle}
              >
                <MemoPanelIcon />
              </button>
            )}
          </div>
        )}
      />
    </div>
  )
}
