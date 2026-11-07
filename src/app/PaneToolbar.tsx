import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, LinkSimple, StackSimple, CaretDown, Copy, DotsThree, SquaresFour } from '@phosphor-icons/react'
import { OVERLAY_TOOLS } from '../pdf/PdfOverlayPalette'
import { useOverlayTool } from '../pdf/overlayToolStore'
import { HighlighterToolbarControl } from '../pdf/HighlighterTool'
import { INITIAL_READER_TOOL_STATE, readerToolReducer, type ReaderToolAction, type ReaderToolState } from '../core/readerTools'
import { ReaderToolbar } from './ReaderToolbar'
import { CleanViewButton, PdfPageLayoutButtons, PdfSplitPicker, type PdfPageLayout } from './PdfLayoutControls'
import type { PdfSplitLayoutId } from '../core/pdfSplit'
import '../ui/pdf-followup.css'
import { t } from '../i18n'

/** hand: 손 도구(PDF). 글자 위에서는 글을 고르고, 빈 곳은 잡고 끌어 화면을 옮긴다 */
export type ReaderPaneToolMode = 'hand' | 'text' | 'lasso' | 'highlight' | 'box' | 'edit'
export type PdfToolMode = ReaderPaneToolMode

interface PaneToolbarProps {
  readonly kind: 'pdf' | 'markdown'
  readonly mode: ReaderPaneToolMode
  readonly onModeChange: (mode: ReaderPaneToolMode) => void
  readonly query?: string
  readonly onQueryChange?: (query: string) => void
  /** 문서 패널이 화면을 차지하고 있는가 */
  readonly fullscreen?: boolean
  readonly onToggleFullscreen?: () => void
  /** 인쇄(PDF). 주면 도구줄에 인쇄 단추가 나온다 */
  readonly onPrint?: () => void
  /** 이 문서가 판 묶음이면 지금 보는 판 이름. 주면 도구줄에 판 칩이 나온다(누르면 판 고르기 — 이 탭만 바뀐다) */
  readonly versionLabel?: string
  readonly onOpenVersions?: (anchor: DOMRect) => void
  /** 원본 출처. 주면 링크 단추가 나온다(출처 수가 배지). 누르면 출처 창 */
  readonly sourceCount?: number
  readonly onOpenSources?: () => void
  /** PDF 파일을 클립보드에 복사(탐색기·메일·메신저에 붙여 넣으면 파일이 들어간다) */
  readonly onCopyFile?: () => void
  /** PDF 쪽 배치(한 장·두 장·세 장·연속). 주면 도구줄 앞에 단추 넷이 나온다 */
  readonly pageLayout?: PdfPageLayout
  readonly onPageLayoutChange?: (layout: PdfPageLayout) => void
  /** 깨끗이 보기(내 표시 모두 감추기) */
  readonly cleanView?: boolean
  readonly onCleanViewChange?: (clean: boolean) => void
  /** 화면 나누기 배치. 주면 배치 고르는 단추가 나온다 */
  readonly splitLayout?: PdfSplitLayoutId
  readonly onSplitLayoutChange?: (id: PdfSplitLayoutId) => void
  /** 쪽 편집(쪽 미리보기로 순서 바꾸기·끼워 넣기·빼기). 주면 쪽 편집 단추가 나온다 */
  readonly onEditPages?: () => void
}

export function PaneToolbar({
  kind,
  mode,
  onModeChange,
  query,
  onQueryChange,
  fullscreen = false,
  onToggleFullscreen,
  onPrint,
  versionLabel,
  onOpenVersions,
  sourceCount = 0,
  onOpenSources,
  onCopyFile,
  pageLayout,
  onPageLayoutChange,
  cleanView,
  onCleanViewChange,
  splitLayout,
  onSplitLayoutChange,
  onEditPages,
}: PaneToolbarProps) {
  const [overlayTool, setOverlayTool] = useOverlayTool()
  const [toolbarState, updateToolbarState] = useReducer(readerToolReducer, INITIAL_READER_TOOL_STATE)
  const state: ReaderToolState = {
    ...toolbarState,
    primary: mode === 'lasso' ? 'region-select' : mode === 'highlight' ? 'highlight' : mode === 'box' ? 'box-memo' : mode === 'edit' ? 'edit' : mode === 'hand' ? 'pan' : 'text-select',
  }
  const dispatch = (action: ReaderToolAction) => {
    if (action.type === 'toggle') {
      if (action.mode === 'pan') onModeChange('hand')
      else if (action.mode === 'region-select') onModeChange('lasso')
      else if (action.mode === 'highlight') onModeChange('highlight')
      else if (action.mode === 'box-memo') onModeChange(mode === 'box' ? 'text' : 'box')
      else if (action.mode === 'edit') onModeChange(mode === 'edit' ? 'text' : 'edit')
      else onModeChange('text')
      return
    }
    updateToolbarState(action)
  }


  // 넘침 처리: 도구줄(부모)이 모자라면 단계를 올리고, 그 단계를 처음 넘쳤던 너비만큼 다시 넓어지면 내린다
  const leftRef = useRef<HTMLDivElement | null>(null)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const morePanelRef = useRef<HTMLDivElement | null>(null)
  const [overflowLevel, setOverflowLevel] = useState(0)
  const [, setResizeTick] = useState(0)
  const needWidthRef = useRef<number[]>([])
  const [moreOpen, setMoreOpen] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    const bar = leftRef.current?.parentElement
    if (bar == null) return
    if (bar.scrollWidth > bar.clientWidth + 1 && overflowLevel < 3) {
      needWidthRef.current[overflowLevel] = bar.scrollWidth
      setOverflowLevel(overflowLevel + 1)
      return
    }
    const need = needWidthRef.current[overflowLevel - 1]
    if (overflowLevel > 0 && need !== undefined && bar.clientWidth >= need) setOverflowLevel(overflowLevel - 1)
  })
  useEffect(() => {
    const bar = leftRef.current?.parentElement
    if (bar == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setResizeTick((tick) => tick + 1))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (moreOpen === null) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (moreRef.current?.contains(event.target) || morePanelRef.current?.contains(event.target))) return
      // 「⋯」 안에서 연 다른 떠 있는 창(화면 나누기 목록 등)을 누르는 것은 닫지 않는다
      if (event.target instanceof Element && event.target.closest('.pdf-split-menu, .version-menu') !== null) return
      setMoreOpen(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [moreOpen])
  useEffect(() => { if (overflowLevel === 0) setMoreOpen(null) }, [overflowLevel])

  const layoutGroup = (
    <>
      {pageLayout !== undefined && onPageLayoutChange !== undefined ? (
        <PdfPageLayoutButtons layout={pageLayout} onChange={onPageLayoutChange} buttonClassName="toolbar-tool-btn pdf-compact-tool" clean={cleanView} onCleanChange={onCleanViewChange} />
      ) : cleanView !== undefined && onCleanViewChange !== undefined ? (
        // 쪽 배치가 없는 문서(Markdown)도 깨끗이 보기는 같다
        <CleanViewButton clean={cleanView} onChange={onCleanViewChange} buttonClassName="toolbar-tool-btn pdf-compact-tool" />
      ) : null}
      {splitLayout !== undefined && onSplitLayoutChange !== undefined ? (
        <PdfSplitPicker value={splitLayout} onChange={onSplitLayoutChange} buttonClassName="toolbar-tool-btn pdf-compact-tool" />
      ) : null}
    </>
  )
  const hasLayoutGroup = pageLayout !== undefined || splitLayout !== undefined || cleanView !== undefined
  // PDF 위에 쓰는 도구: 박스 메모, 편집 도구 넷(글 상자·펜·지우개·선 — 누르면 바로 그 도구로), 쪽 편집
  const writeGroup = kind === 'pdf' || kind === 'markdown' ? (
    <>
      <ReaderToolbar
        state={state}
        dispatch={dispatch}
        modes={['box-memo']}
        className="pdf-inline-tools pdf-write-tools"
        toolsClassName="pdf-mode-toggle-row"
        buttonClassName="toolbar-tool-btn pdf-compact-tool"
      />
      <div className="reader-toolbar pdf-inline-tools pdf-write-tools pane-overlay-tools" role="group" aria-label={t('편집 도구')}>
        {OVERLAY_TOOLS.map((item) => {
          const active = mode === 'edit' && overlayTool === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`reader-tool-button toolbar-tool-btn pdf-compact-tool${active ? ' reader-tool-button-active toolbar-tool-btn-active' : ''}`}
              aria-label={t(item.label)}
              title={t(item.label)}
              aria-pressed={active}
              onClick={() => {
                if (active) {
                  onModeChange('text')
                  return
                }
                setOverlayTool(item.id)
                onModeChange('edit')
              }}
            >
              {item.icon(17, active)}
            </button>
          )
        })}
      </div>
      {onEditPages !== undefined ? (
        <>
          <span className="pane-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="toolbar-tool-btn pdf-compact-tool pane-edit-pages"
            aria-label={t('쪽 편집')}
            title={t('쪽 편집')}
            onClick={onEditPages}
          >
            <SquaresFour size={17} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </>
  ) : null
  const docGroup = (
    <>
      {versionLabel !== undefined && onOpenVersions !== undefined ? (
        <button
          type="button"
          className="toolbar-tool-btn pdf-compact-tool pane-version-chip"
          aria-label={t('버전 고르기: 지금 {label}', { label: versionLabel })}
          title={t('버전 고르기 (이 탭만 바뀜)')}
          aria-haspopup="menu"
          onClick={(event) => onOpenVersions(event.currentTarget.getBoundingClientRect())}
        >
          <StackSimple size={14} aria-hidden="true" />
          <span>{versionLabel}</span>
          <CaretDown size={9} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {onOpenSources !== undefined ? (
        <button
          type="button"
          className={`toolbar-tool-btn pdf-compact-tool pane-sources${sourceCount > 0 ? ' pane-sources-has' : ''}`}
          aria-label={t('원본 출처')}
          title={t('원본 출처')}
          onClick={onOpenSources}
        >
          <LinkSimple size={15} aria-hidden="true" />
          {sourceCount > 0 ? <span className="pane-sources-count">{sourceCount}</span> : null}
        </button>
      ) : null}
      {onCopyFile !== undefined ? (
        <button
          type="button"
          className="toolbar-tool-btn pdf-compact-tool pane-copy-file"
          aria-label={t('PDF 파일 복사')}
          title={t('PDF 파일 복사')}
          onClick={onCopyFile}
        >
          <Copy size={15} aria-hidden="true" />
        </button>
      ) : null}
      {onPrint !== undefined ? (
        <button
          type="button"
          className="toolbar-tool-btn pdf-compact-tool pane-print"
          aria-label={t('인쇄')}
          title={`${t('인쇄')} (Ctrl+P)`}
          onClick={onPrint}
        >
          <Printer size={15} aria-hidden="true" />
        </button>
      ) : null}
    </>
  )
  const hasDocGroup = (versionLabel !== undefined && onOpenVersions !== undefined) || onOpenSources !== undefined || onCopyFile !== undefined || onPrint !== undefined
  // 너비가 모자라면 덜 쓰는 묶음부터 「⋯」 안으로: 1 = 쪽 배치·화면 나누기, 2 = 판·출처·복사·인쇄, 3 = 박스 메모·편집 도구·쪽 편집
  const inMenu = (group: 1 | 2 | 3) => overflowLevel >= group

  return (
    <>
      <div className="pane-toolbar-left" ref={leftRef}>
        <ReaderToolbar
          state={state}
          dispatch={dispatch}
          query={kind === 'markdown' ? query : undefined}
          onQueryChange={kind === 'markdown' ? onQueryChange : undefined}
          // 형광펜은 PDF·Markdown 모두 문서 오른쪽 위의 떠 있는 형광펜 도구로(색·지우개)
          modes={['pan', 'text-select', 'region-select']}
          modeLabels={{ 'region-select': '영역 캡처' }}
          className="pdf-inline-tools"
          toolsClassName="pdf-mode-toggle-row"
          buttonClassName="toolbar-tool-btn pdf-compact-tool"
        />
        {kind === 'pdf' || kind === 'markdown' ? (
          <HighlighterToolbarControl active={mode === 'highlight'} onActiveChange={(on) => onModeChange(on ? 'highlight' : 'text')} buttonClassName="toolbar-tool-btn pdf-compact-tool" />
        ) : null}
        {writeGroup !== null && !inMenu(3) ? (
          <>
            {/* PDF 위에 쓰는 도구(박스 메모·편집)는 읽기 도구와 떼어 둔다 */}
            <span className="pane-toolbar-divider" aria-hidden="true" />
            {writeGroup}
          </>
        ) : null}
      </div>
      <div className="pane-toolbar-right">
        {hasLayoutGroup && !inMenu(1) ? (
          <>
            {layoutGroup}
            <span className="pane-toolbar-divider" aria-hidden="true" />
          </>
        ) : null}
        {hasDocGroup && !inMenu(2) ? docGroup : null}
        {overflowLevel > 0 ? (
          <div className="pane-toolbar-more" ref={moreRef}>
            <button
              type="button"
              className={`toolbar-tool-btn pdf-compact-tool${moreOpen !== null ? ' toolbar-tool-btn-active' : ''}`}
              aria-label={t('도구 더 보기')}
              title={t('도구 더 보기')}
              aria-haspopup="menu"
              aria-expanded={moreOpen !== null}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMoreOpen((shown) => (shown !== null ? null : { top: rect.bottom + 6, right: Math.max(window.innerWidth - rect.right, 8) }))
              }}
            >
              <DotsThree size={16} weight="bold" aria-hidden="true" />
            </button>
            {moreOpen !== null ? createPortal(
              <div ref={morePanelRef} className="pane-toolbar-more-panel pane-doc" role="menu" aria-label={t('도구 더 보기')} style={{ top: moreOpen.top, right: moreOpen.right }}>
                {writeGroup !== null && inMenu(3) ? <div className="pane-toolbar-more-row">{writeGroup}</div> : null}
                {hasDocGroup && inMenu(2) ? <div className="pane-toolbar-more-row">{docGroup}</div> : null}
                {hasLayoutGroup && inMenu(1) ? <div className="pane-toolbar-more-row">{layoutGroup}</div> : null}
              </div>,
              document.body,
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}
