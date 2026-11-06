import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ImagesSquare, Newspaper, MagnifyingGlass, Printer,
  ListMagnifyingGlass,
  ListBullets,
  SidebarSimple,
  TreeStructure,
} from '@phosphor-icons/react'
import { closeWindow } from '../bridge/window'
import { WindowControls } from './WindowControls'
import { PdfSplitPicker } from './PdfLayoutControls'
import type { PdfSplitLayoutId } from '../core/pdfSplit'
import { MemoPanelIcon } from '../pdf/MemoPanelIcon'
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
  /** 인쇄(지금 PDF). 주면 맨 위 줄 왼쪽에 인쇄 단추가 나온다 */
  onPrint?: () => void
  /** 오른쪽 메모 바 펼침/접기. PDF 를 보고 있을 때만 준다 */
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
  memoBar,
  onPrint,
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
  return (
    <div
      className={`topbar${singlePane ? ' topbar-single' : ''}${sidebarCollapsed ? ' topbar-sidebar-collapsed' : ''}${sidebarCollapsed || !sidebarVisible ? ' topbar-sidebar-unreserved' : ''}`}
      style={actionsWidth === null || actionsWidth <= 0 ? undefined : { '--topbar-actions-w': `${actionsWidth}px` } as CSSProperties}
      data-tauri-drag-region="deep"
    >
      <div className="topbar-leftcluster">
        <div className="topbar-leftcluster-actions" ref={actionsRef}>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? t('사이드바 펼치기') : t('사이드바 접기')}
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <SidebarSimple size={15} weight={sidebarCollapsed ? 'regular' : 'fill'} aria-hidden="true" />
        </button>

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
          // 창 나누기: PDF 안 화면 나누기와 같은 배치 고르기. 앱 창은 좌우로만 나눈다(탭 줄이 패널 위에 나란히 있다)
          <PdfSplitPicker
            value={paneLayout}
            onChange={onPaneLayoutChange}
            label={t('창 나누기')}
            head={t('창 나누기 · 다른 문서를 나란히 봅니다')}
            align="left"
            buttonClassName="topbar-navbtn topbar-panecount-cycle"
            activeClassName="topbar-navbtn-active"
            shortcut={t('(Ctrl+\\ 로 차례로)')}
          />
        )}
        <span className="topbar-sep" aria-hidden="true" />
        <div className="topbar-nav" role="radiogroup" aria-label={t('사이드바 보기')}>
          <button type="button" className={`topbar-navbtn${sidebarMode === 'library' ? ' topbar-navbtn-active' : ''}`} aria-label={t('탐색기')} role="radio" aria-checked={sidebarMode === 'library'} onClick={() => onSidebarModeChange('library')}>
            <TreeStructure size={15} weight="regular" aria-hidden="true" />
          </button>
          <button type="button" className={`topbar-navbtn${sidebarMode === 'outline' ? ' topbar-navbtn-active' : ''}`} aria-label={t('목록')} role="radio" aria-checked={sidebarMode === 'outline'} onClick={() => onSidebarModeChange('outline')}>
            <ListBullets size={15} weight="regular" aria-hidden="true" />
          </button>
          <button type="button" className={`topbar-navbtn${sidebarMode === 'thumbnails' ? ' topbar-navbtn-active' : ''}`} aria-label={t('미리보기')} role="radio" aria-checked={sidebarMode === 'thumbnails'} onClick={() => onSidebarModeChange('thumbnails')}>
            <ImagesSquare size={15} weight="regular" aria-hidden="true" />
          </button>
          <button type="button" className={`topbar-navbtn${sidebarMode === 'outlinePreview' ? ' topbar-navbtn-active' : ''}`} aria-label={t('목차·미리보기')} role="radio" aria-checked={sidebarMode === 'outlinePreview'} onClick={() => onSidebarModeChange('outlinePreview')}>
            <Newspaper size={15} weight="regular" aria-hidden="true" />
          </button>
          <button type="button" className={`topbar-navbtn${sidebarMode === 'search' ? ' topbar-navbtn-active' : ''}`} aria-label={t('PDF 검색')} title={t('PDF 검색 (Ctrl+F)')} role="radio" aria-checked={sidebarMode === 'search'} onClick={() => onSidebarModeChange('search')}>
            <MagnifyingGlass size={15} weight="regular" aria-hidden="true" />
          </button>
        </div>
        {onPrint === undefined ? null : (
          <button type="button" className="topbar-navbtn topbar-print" aria-label={t('인쇄')} title={t('인쇄 (Ctrl+P)')} onClick={onPrint}>
            <Printer size={15} weight="regular" aria-hidden="true" />
          </button>
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
        leading={memoBar === undefined ? null : (
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
      />
    </div>
  )
}

/** 단 수 아이콘: 둥근 틀 안의 세로 칸(1단 = 통짜, 2·3단 = 칸 사이에 틈). 위쪽 탭 막대 하나로 창처럼 보이게 한다 */
function PaneCountIcon({ count }: { readonly count: 1 | 2 | 3 }) {
  const gap = 1.6
  const left = 2.5
  const total = 13
  const width = (total - gap * (count - 1)) / count
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" focusable="false">
      <rect x="1" y="1.5" width="16" height="13" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {Array.from({ length: count }, (_, index) => (
        <rect key={index} x={left + index * (width + gap)} y="4" width={width} height="8.5" rx="1" fill="currentColor" opacity={0.85} />
      ))}
    </svg>
  )
}
