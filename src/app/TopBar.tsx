import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ImagesSquare, Newspaper, MagnifyingGlass,
  ListMagnifyingGlass,
  ListBullets,
  SidebarSimple,
  TreeStructure,
} from '@phosphor-icons/react'
import { closeWindow } from '../bridge/window'
import { WindowControls } from './WindowControls'
import { PdfSplitPicker } from './PdfLayoutControls'
import type { PdfSplitLayoutId } from '../core/pdfSplit'
import { AppMenu, type AppMenuGroups } from './AppMenu'
import { MemoPanelIcon } from '../pdf/MemoPanelIcon'
import { isMacPlatform } from '../core/platform'
import { t } from '../i18n'

export type SidebarMode = 'library' | 'thumbnails' | 'outlinePreview' | 'outline' | 'search'

interface TopBarProps {
  sidebarCollapsed: boolean
  sidebarVisible?: boolean
  onToggleSidebar: () => void
  sidebarMode: SidebarMode
  onSidebarModeChange: (mode: SidebarMode) => void
  sidebarPx: number
  leftFrac: number
  leftTabs: ReactNode
  rightTabs: ReactNode
  onCloseWindow?: () => void
  /** 문서 검색 화면인가. 단추가 눌린 모양이 된다 */
  docSearchActive?: boolean
  onToggleDocSearch?: () => void
  /** 1단 보기인가(탭 줄 배치용) */
  singlePane?: boolean
  /** 창 나누기 배치. onPaneLayoutChange 가 있으면 배치 고르는 단추가 나온다 */
  paneLayout?: PdfSplitLayoutId
  onPaneLayoutChange?: (layout: PdfSplitLayoutId) => void
  /**
   * 격자 배치(위아래·2×2 …)의 맨 윗줄 칸들. 주면 그 칸들의 탭 줄을 칸 폭에 맞춰 상단바에 얹는다
   * (아랫줄 칸의 탭은 칸 안에 있다)
   */
  gridZones?: readonly { readonly paneId: string; readonly tabs: ReactNode; readonly grow: number }[]
  /** 3단일 때 세 번째(맨 오른쪽) 패널의 탭 줄과 세 패널의 폭 비율 */
  thirdTabs?: ReactNode
  paneGrows?: readonly [number, number, number]
  /** 로고 메뉴의 항목들(인쇄·화면·설정 …). 주면 맨 왼쪽에 로고 메뉴 단추가 나온다 */
  appMenu?: AppMenuGroups
  /** 사이드바 접기·펴기 단추를 숨긴다(왼쪽 바가 없는 떼어 낸 창) */
  hideSidebarToggle?: boolean
  /** 오른쪽 메모 바 열기·닫기. 모든 칸의 메모 바가 함께 열리므로 상단바에 하나만 둔다. PDF·Markdown 을 볼 때만 준다 */
  memoBar?: { readonly visible: boolean; readonly onToggle: () => void }
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
  rightTabs,
  onCloseWindow = closeWindow,
  docSearchActive = false,
  onToggleDocSearch,
  singlePane = false,
  paneLayout = 'single',
  onPaneLayoutChange,
  gridZones,
  thirdTabs,
  paneGrows,
  appMenu,
  memoBar,
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
  // 오른쪽 창 단추 묶음(문서 검색·창 나누기·창 단추)의 폭. 맨 오른쪽 탭 줄이 그만큼 비워 둔다
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
            <button type="button" className={`topbar-navbtn${sidebarMode === 'outlinePreview' ? ' topbar-navbtn-active' : ''}`} aria-label={t('목차·미리보기')} title={t('목차·미리보기')} role="radio" aria-checked={sidebarMode === 'outlinePreview'} onClick={() => onSidebarModeChange('outlinePreview')}>
              <Newspaper size={15} weight="regular" aria-hidden="true" />
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
        {gridZones !== undefined && !docSearchActive ? (
          gridZones.map((zone, index) => (
            <Fragment key={zone.paneId}>
              {index === 0 ? null : <div className="topbar-pane-divider" aria-hidden="true" />}
              <div
                className={`topbar-panetab-zone${index === gridZones.length - 1 ? ' topbar-panetab-zone-right' : index > 0 ? ' topbar-panetab-zone-middle' : ''}`}
                data-pane-id={zone.paneId}
                style={{ flexGrow: zone.grow }}
              >
                {zone.tabs}
              </div>
            </Fragment>
          ))
        ) : thirdTabs !== undefined && paneGrows !== undefined ? (
          <>
            <div className="topbar-panetab-zone" data-pane-id="left" style={{ flexGrow: paneGrows[0] }}>{leftTabs}</div>
            <div className="topbar-pane-divider" aria-hidden="true" />
            <div className="topbar-panetab-zone topbar-panetab-zone-middle" data-pane-id="right" style={{ flexGrow: paneGrows[1] }}>{rightTabs}</div>
            <div className="topbar-pane-divider" aria-hidden="true" />
            <div className="topbar-panetab-zone topbar-panetab-zone-right" data-pane-id="third" style={{ flexGrow: paneGrows[2] }}>{thirdTabs}</div>
          </>
        ) : (
          <>
            <div className="topbar-panetab-zone" data-pane-id="left" style={{ flexGrow: leftFrac }}>{leftTabs}</div>
            <div className="topbar-pane-divider" aria-hidden="true" />
            <div className="topbar-panetab-zone topbar-panetab-zone-right" data-pane-id="right" style={{ flexGrow: 1 - leftFrac }}>{rightTabs}</div>
          </>
        )}
      </div>

      <WindowControls
        onCloseWindow={onCloseWindow}
        leading={(
          // 창 전체에 관한 단추(문서 검색·창 나누기)는 창 단추 곁에 둔다
          <div className="topbar-window-tools">
            {onToggleDocSearch === undefined ? null : (
              <button
                type="button"
                className={`topbar-navbtn topbar-docsearch-btn${docSearchActive ? ' topbar-navbtn-active' : ''}`}
                aria-label={t('문서 검색')}
                aria-pressed={docSearchActive}
                title={t('문서 검색 (Ctrl+Shift+F)')}
                onClick={onToggleDocSearch}
              >
                <ListMagnifyingGlass size={16} weight={docSearchActive ? 'bold' : 'regular'} aria-hidden="true" />
              </button>
            )}
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
              />
            )}
            {memoBar === undefined ? null : (
              <button
                type="button"
                className={`topbar-navbtn topbar-memo-toggle${memoBar.visible ? ' topbar-navbtn-active' : ''}`}
                aria-label={memoBar.visible ? t('메모 바 닫기') : t('메모 바 열기')}
                aria-pressed={memoBar.visible}
                title={memoBar.visible ? t('메모 바 닫기') : t('메모 바 열기')}
                onClick={memoBar.onToggle}
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
