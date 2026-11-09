import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, LinkSimple, StackSimple, CaretDown, Copy, DotsThree, SquaresFour, GithubLogo, ArrowsClockwise, DownloadSimple, ClockCounterClockwise, ArrowSquareOut } from '@phosphor-icons/react'
import { OVERLAY_TOOLS, overlayToolInfo } from '../pdf/PdfOverlayPalette'
import { DRAW_TOOLS, isDrawTool, setLastDrawTool, useLastDrawTool, useOverlayTool } from '../pdf/overlayToolStore'
import type { OverlayTool } from '../pdf/PdfOverlayLayer'
import { ContextMenu } from '../ui/ContextMenu'
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
  /** GitHub 와 이어진 폴더의 문서: 새 소식 확인·최신으로 받기·버전·GitHub 에서 열기 */
  readonly github?: { readonly name: string; readonly behind: number; readonly onAction: (action: 'fetch' | 'pull' | 'versions' | 'open') => void }
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
  /** 한 글자 단축키(T·P·L·A·R·O·E)를 이 도구줄이 받는가(마지막으로 만진 문서 칸) */
  readonly shortcutsEnabled?: boolean
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
  github,
  onCopyFile,
  pageLayout,
  onPageLayoutChange,
  cleanView,
  onCleanViewChange,
  splitLayout,
  onSplitLayoutChange,
  onEditPages,
  shortcutsEnabled = false,
}: PaneToolbarProps) {
  const [overlayTool, setOverlayTool] = useOverlayTool()
  const lastDraw = useLastDrawTool()
  const drawActive = mode === 'edit' && isDrawTool(overlayTool)
  const [drawMenu, setDrawMenu] = useState<{ x: number; y: number } | null>(null)
  /** 편집 도구 고르기(같은 도구를 다시 고르면 끈다). 그리기 도구면 그리기 단추에 그것이 남는다 */
  const pickTool = (id: OverlayTool, toggle = false) => {
    if (toggle && mode === 'edit' && overlayTool === id) {
      onModeChange('text')
      return
    }
    if (isDrawTool(id)) setLastDrawTool(id)
    setOverlayTool(id)
    onModeChange('edit')
  }
  const toolButton = (id: OverlayTool, extraClass = '') => {
    const info = overlayToolInfo(id)
    const active = mode === 'edit' && overlayTool === id
    return (
      <button
        key={id}
        type="button"
        className={`reader-tool-button toolbar-tool-btn pdf-compact-tool${extraClass === '' ? '' : ` ${extraClass}`}${active ? ' reader-tool-button-active toolbar-tool-btn-active' : ''}`}
        aria-label={t(info.label)}
        title={`${t(info.label)} (${info.shortcut})`}
        aria-pressed={active}
        onClick={(event) => {
          // 누른 단추에 초점 테두리가 남아 두 도구가 켜진 것처럼 보이지 않게
          event.currentTarget.blur()
          pickTool(id, true)
        }}
      >
        {info.icon(17, active)}
      </button>
    )
  }
  // 한 글자 단축키(T·P·L·A·R·O·E): 이 문서 칸이 마지막으로 만진 칸일 때, 글 쓰는 칸 밖에서
  useEffect(() => {
    if (!shortcutsEnabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/iu.test(target.tagName))) return
      const info = OVERLAY_TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase())
      if (info === undefined) return
      event.preventDefault()
      pickTool(info.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
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
      {/* 쓰기·그리기: 글 상자 · 그리기 ▾(펜·선·화살표·네모·동그라미를 한 단추에, 마지막 것이 보임) · 지우개 */}
      <div className="reader-toolbar pdf-inline-tools pdf-write-tools pane-overlay-tools" role="group" aria-label={t('편집 도구')}>
        {(['text'] as const).map((id) => toolButton(id))}
        <div className={`pane-draw-split${drawActive ? ' pane-draw-split-on' : ''}`}>
          {toolButton(lastDraw, 'pane-draw-main')}
          <button
            type="button"
            className="toolbar-tool-btn pdf-compact-tool pane-draw-caret"
            aria-label={t('그리기 도구 고르기')}
            title={t('그리기 도구 고르기')}
            aria-haspopup="menu"
            aria-expanded={drawMenu !== null}
            onClick={(event) => {
              event.currentTarget.blur()
              const rect = event.currentTarget.parentElement?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()
              setDrawMenu(drawMenu === null ? { x: rect.left, y: rect.bottom + 6 } : null)
            }}
          >
            <CaretDown size={9} weight="bold" aria-hidden="true" />
          </button>
        </div>
        {toolButton('eraser')}
      </div>
      {drawMenu === null ? null : (
        <ContextMenu
          x={drawMenu.x}
          y={drawMenu.y}
          label={t('그리기')}
          onClose={() => setDrawMenu(null)}
          entries={[
            { key: 'title', note: t('그리기') },
            ...DRAW_TOOLS.map((id) => {
              const info = overlayToolInfo(id)
              return { key: id, icon: info.icon(15, false), label: t(info.label), shortcut: info.shortcut, current: id === (drawActive ? overlayTool : lastDraw), onSelect: () => pickTool(id) }
            }),
          ]}
        />
      )}
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
      {github !== undefined ? <GithubToolbarButton github={github} /> : null}
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
  const hasDocGroup = (versionLabel !== undefined && onOpenVersions !== undefined) || onOpenSources !== undefined || onCopyFile !== undefined || onPrint !== undefined || github !== undefined
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

/** 문서 도구줄의 GitHub 단추: 받을 커밋 수를 배지로, 누르면 아래로 작은 메뉴 */
function GithubToolbarButton({ github }: { readonly github: NonNullable<PaneToolbarProps['github']> }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect !== undefined) setPlace({ left: Math.max(8, rect.right - 232), top: rect.bottom + 6 })
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.pane-github-menu') == null && !buttonRef.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])
  const run = (action: 'fetch' | 'pull' | 'versions' | 'open') => () => {
    setOpen(false)
    github.onAction(action)
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`toolbar-tool-btn pdf-compact-tool pane-github${github.behind > 0 ? ' pane-github-behind' : ''}`}
        aria-label={github.behind > 0 ? t('GitHub: 받을 것 {count}개', { count: github.behind }) : t('GitHub')}
        title={t('GitHub · {name}', { name: github.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <GithubLogo size={15} aria-hidden="true" />
        {github.behind > 0 ? <span className="pane-sources-count">{github.behind}</span> : null}
      </button>
      {open && place !== null ? createPortal(
        <div className="pane-github-menu" role="menu" aria-label={t('GitHub')} style={{ left: place.left, top: place.top }}>
          <button type="button" role="menuitem" onClick={run('fetch')}><ArrowsClockwise size={15} aria-hidden="true" /><span>{t('새 소식 확인')}</span></button>
          <button type="button" role="menuitem" onClick={run('pull')}><DownloadSimple size={15} aria-hidden="true" /><span>{github.behind > 0 ? t('최신으로 받기 ({count})', { count: github.behind }) : t('최신으로 받기')}</span></button>
          <button type="button" role="menuitem" onClick={run('versions')}><ClockCounterClockwise size={15} aria-hidden="true" /><span>{t('버전 보기')}</span></button>
          <div className="pane-github-sep" role="separator" />
          <button type="button" role="menuitem" onClick={run('open')}><ArrowSquareOut size={15} aria-hidden="true" /><span>{t('GitHub 에서 열기')}</span></button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
