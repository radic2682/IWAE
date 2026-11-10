import { runAppCommand } from '../ui/documentContextMenu'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { PaneShell } from './PaneShell'
import { PaneToolbar, type PdfToolMode } from './PaneToolbar'
import { PdfSearchPanel } from './PdfSearchPanel'
import { clampZoom, stepZoom } from '../core/pdfZoom'
import { peekInitialZoom } from './pendingViewState'
import { usePdfSearch } from './usePdfSearch'
import { PdfBottomBar } from './PdfBottomBar'
import { PdfViewMenu } from './PdfViewMenu'
import { PdfPrintDialog } from './PdfPrintDialog'
import { createPortal } from 'react-dom'
import { printPdfPages, printMarkdown } from './pdfPrint'
import { MarkdownPane, type MarkdownSelectionTranslation } from './MarkdownPane'
import { MarkdownSearchPanel, type MarkdownSearchHit } from './MarkdownSearchPanel'
import { PdfPane, pageFitZoom, pageHeightFitZoom } from '../pdf/PdfPane'
import type { PdfSelectionTranslation } from '../pdf/SelectionActions'
import type { PaneId, Tab, TabsState } from './tabs'
import type { PdfDocMeta } from '../bridge/pdf'
import type { PdfSearchOptions } from '../core/pdfSearch'
import type { Anchor } from '../core/anchor'
import type { NavLocation } from '../core/navigationHistory'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import type { MarkdownExcerptDragPayload, MarkdownSourceJumpRequest } from '../core/markdownExcerpt'
import type { MarkdownThemeId } from '../core/markdownTheme'
import type { VisiblePdfSourceReference, VisibleSourceReference } from '../core/workspaceSources'
import { nextRotation, spreadColumns, type PdfRotation, type PdfViewPrefs } from '../core/pdfViewPrefs'
import { parseGoto, resolveGoto } from '../core/pdfGoto'
import { buildAnchor } from '../core/anchor'
import { pageTextIndex, pdfOutline } from '../bridge/pdf'
import { announceAction } from './actionFeedback'
import { CrossRefPreview } from './CrossRefPreview'
import type { PdfBookmark } from '../core/pdfBookmarks'
import type { PdfPinPatch } from './usePdfBookmarks'
import { closeSplitCell, evenFractions, fractionOffset, moveSplitBoundary, pdfSplitLayout, splitDividers, type PdfSplitLayoutId } from '../core/pdfSplit'
import { X } from '@phosphor-icons/react'
import type { GotoHit } from '../core/pdfGoto'
import { t } from '../i18n'
import '../ui/pdf-followup.css'
import '../ui/pdf-split.css'

type PdfPaneProps = ComponentProps<typeof PdfPane>
type MarkdownPaneProps = ComponentProps<typeof MarkdownPane>

type ZoomState = { readonly fit: 'width' | 'page' | 'height' | null; readonly actual: number }
type Viewport = { readonly width: number; readonly height: number }

/** 화면 나누기 칸 하나가 보는 자리. 칸마다 쪽·배율이 따로다 */
interface SplitView {
  readonly page: number
  readonly request: { readonly page: number; readonly nonce: number }
  readonly viewport: Viewport
  readonly zoom: ZoomState
}

/** 한 PDF 의 화면 나누기 상태. 탭을 오가도 PDF 마다 기억한다 */
interface SplitState {
  readonly layout: PdfSplitLayoutId
  readonly cols: readonly number[]
  readonly rows: readonly number[]
  readonly views: readonly SplitView[]
  /** 위·아래 막대가 다루는 칸 */
  readonly focused: number
}

/** 칸은 많아야 넷 */
const MAX_SPLIT_CELLS = 4

function singleSplit(page: number, zoom: ZoomState = { fit: 'width', actual: 100 }): SplitState {
  return {
    layout: 'single',
    cols: [1],
    rows: [1],
    views: [{ page, request: { page, nonce: 0 }, viewport: { width: 0, height: 0 }, zoom }],
    focused: 0,
  }
}

function withView(state: SplitState, index: number, change: (view: SplitView) => SplitView): SplitState {
  const current = state.views[index]
  if (current === undefined) return state
  const next = change(current)
  return next === current ? state : { ...state, views: state.views.map((view, at) => (at === index ? next : view)) }
}

/** 이 패널이 지금 보여 주는 PDF 와 쪽. App 이 사이드바·기록·출처 표시에 쓴다. */
export interface DocumentViewState {
  docId: string
  page: number
}

/** 다른 곳(사이드바 목차, 출처 이동)에서 이 패널의 쪽을 바꾸는 손잡이 */
export interface DocumentViewController {
  docId: string | null
  requestPage: (page: number) => void
  /** 지금 칸의 배율(문서를 다른 창으로 떼어 낼 때 따라가게) */
  getZoom?: () => ZoomState | null
}

export interface DocumentViewProps {
  paneId: PaneId
  state: TabsState
  tab: Tab
  meta: PdfDocMeta | null
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** 다른 문서의 특정 쪽으로 갈 때 App 이 맡겨 둔 쪽. 이 문서 것이면 꺼내 쓴다 */
  pendingPageRef: MutableRefObject<NavLocation | null>
  readingPositions: Readonly<Record<string, number>>
  recordReadingPosition: (docId: string, page: number) => void
  onViewChange: (pane: PaneId, view: DocumentViewState | null) => void
  controllersRef: MutableRefObject<Partial<Record<PaneId, DocumentViewController>>>
  /** 이 패널이 마지막으로 만진 문서 패널인가. Ctrl+F 같은 단축키를 받는다 */
  shortcutTarget: boolean
  /** 왼쪽 바의 PDF 검색 칸(「PDF 검색」 보기일 때). 검색 칸과 결과를 여기에 그린다 */
  searchSlot?: HTMLElement | null
  jumpToPage: (page: number) => void
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  /** 책갈피 핀(모든 PDF 것. 이 문서 것만 골라 칸마다 스크롤 막대 옆에 꽂는다) */
  pins: readonly PdfBookmark[]
  onAddPin: (docId: string, page: number, y: number, title: string) => string
  onUpdatePin: (id: string, patch: PdfPinPatch) => void
  /** 핀을 꾹 눌러 끌어 다른 자리로 옮겼다 */
  onMovePin?: (id: string, page: number, y: number) => string
  onRemovePin: (id: string) => void
  pdfViewPrefs: PdfViewPrefs
  onPdfViewPrefsChange: (prefs: PdfViewPrefs) => void
  rotations: Readonly<Record<string, PdfRotation>>
  onRotationsChange: (update: (current: Readonly<Record<string, PdfRotation>>) => Readonly<Record<string, PdfRotation>>) => void
  draftHighlight: Anchor | null
  onAnchorCreated: (anchor: Anchor | null) => void
  sourceHighlights: readonly VisibleSourceReference[]
  persistentHighlights: PdfPaneProps['persistentHighlights']
  onPersistentHighlightCreated: PdfPaneProps['onPersistentHighlightCreated']
  onPersistentHighlightRemoved: PdfPaneProps['onPersistentHighlightRemoved']
  onPersistentHighlightUpdated: PdfPaneProps['onPersistentHighlightUpdated']
  onPersistentHighlightsPatched?: PdfPaneProps['onPersistentHighlightsPatched']
  onMemoJump?: PdfPaneProps['onMemoJump']
  docTitles?: PdfPaneProps['docTitles']
  flashHighlightId: string | null
  onSendToCanvas?: (selection: PdfExcerptSelection) => void
  onCopyWithSource?: (selection: PdfExcerptSelection) => void
  onSearchDocuments?: (selection: PdfExcerptSelection) => void
  onTranslateSelection?: (selection: PdfExcerptSelection) => Promise<PdfSelectionTranslation | null>
  onSendTranslatedSelection?: (selection: PdfExcerptSelection, translated: PdfSelectionTranslation) => void
  onExternalLink: (url: string) => void
  onNavigateBack: () => void
  onNavigateForward: () => void
  // Markdown
  markdownSource: string | undefined
  markdownSourceFileId: string
  /** Vault 폴더(Markdown 그림 경로의 기준) */
  vaultRoot?: string
  /** Markdown 안의 다른 문서 링크를 눌렀다(Vault 경로) */
  onOpenMarkdownPath?: (path: string, anchor: string | null) => void
  markdownTheme: MarkdownThemeId
  onTranslateMarkdownSelection?: (text: string) => Promise<MarkdownSelectionTranslation | null>
  /** Markdown 에서 고른 글자로 문서 검색 */
  onSearchDocumentsText?: (text: string) => void
  onSendTranslatedMarkdownSelection?: (payload: MarkdownExcerptDragPayload, translated: MarkdownSelectionTranslation) => void
  markdownHighlights: MarkdownPaneProps['persistentHighlights']
  onMarkdownHighlightCreated: MarkdownPaneProps['onPersistentHighlightCreated']
  onMarkdownHighlightRemoved: MarkdownPaneProps['onPersistentHighlightRemoved']
  markdownJumpRequest: MarkdownSourceJumpRequest | null
  onMarkdownJumpHandled: () => void
  placeholder: string
  /** 탭 바로 아래 도구줄 가운데에 보일 문서 이름 전체와, 그 옆의 보조 이름(원래 제목·파일 이름) */
  fullTitle: string
  /** 이 문서의 원본 출처 수와 창 열기(PDF 도구줄의 링크 단추) */
  sourceCount?: number
  onOpenSources?: () => void
  /** GitHub 와 이어진 폴더 안의 Markdown 이면 도구줄에 GitHub 단추 */
  github?: { readonly name: string; readonly behind: number; readonly onAction: (action: 'fetch' | 'pull' | 'versions' | 'open') => void }
  /** PDF 파일 복사(클립보드) */
  onCopyFile?: () => void
  /** 이 PDF 의 쪽 편집(쪽 미리보기로 순서·끼워 넣기·빼기)을 연다 */
  onEditPages?: (docId: string) => void
  /** 이 PDF 위 편집(글 상자·선)과 변경 */
  overlays?: readonly import('../core/pdfOverlays').PdfOverlay[]
  onOverlayAdd?: (docId: string, overlay: import('../core/pdfOverlays').PdfOverlay) => void
  onOverlayUpdate?: (docId: string, id: string, patch: import('../core/pdfOverlays').OverlayPatch) => void
  onOverlayRemove?: (docId: string, id: string) => void
  /** 판 묶음의 문서면 지금 판 이름과 판 고르기 열기(이 탭만 바뀜) */
  versionLabel?: string
  onOpenVersions?: (anchor: DOMRect) => void
  subtitle?: string
}

/**
 * 한 패널의 PDF/Markdown 보기. 배율·쪽·검색·도구 모드는 패널마다 따로 갖는다 —
 * 양쪽에 PDF 를 하나씩 띄워 판본을 견줄 때 한쪽 배율이 다른 쪽을 따라가면 안 된다.
 * 형광펜·책갈피·출처처럼 문서에 붙는 것은 App 이 한 벌로 갖고 내려준다.
 */
export function DocumentView(props: DocumentViewProps) {
  const { paneId, tab, meta, pendingPageRef, readingPositions, recordReadingPosition, onViewChange, controllersRef } = props
  const readingPositionsRef = useRef(readingPositions)
  readingPositionsRef.current = readingPositions
  /** 문서를 처음 보일 쪽: 맡겨 둔 쪽(검색 결과·출처) → 마지막으로 읽던 쪽 → 1쪽 */
  const startPage = (id: string | null) => {
    if (id === null) return 1
    const pending = pendingPageRef.current
    return pending !== null && pending.docId === id ? pending.page : readingPositionsRef.current[id] ?? 1
  }
  const docId = meta?.docId ?? null
  const docIdRef = useRef(docId)
  docIdRef.current = docId
  // 화면 나누기 상태는 PDF 마다 둔다. 처음 여는 PDF 는 한 화면, 시작 쪽에서 출발한다.
  // 처음 그릴 때는 PdfPane 이 초기 요청 쪽으로 스스로 옮겨 간다. 따로 점프를 걸지 않는다.
  const [splits, setSplits] = useState<Readonly<Record<string, SplitState>>>({})
  // startPage 는 ref 만 읽는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fallbackSplit = useMemo(() => singleSplit(startPage(docId), peekInitialZoom(docId) ?? undefined), [docId])
  const split = (docId === null ? undefined : splits[docId]) ?? fallbackSplit
  const splitRef = useRef(split)
  splitRef.current = split
  const changeSplit = useCallback((change: (state: SplitState) => SplitState) => {
    const id = docIdRef.current
    if (id === null) return
    setSplits((current) => {
      const base = current[id] ?? splitRef.current
      const next = change(base)
      return next === base && current[id] !== undefined ? current : { ...current, [id]: next }
    })
  }, [])
  const splitLayout = pdfSplitLayout(split.layout)
  const focused = Math.min(split.focused, split.views.length - 1)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const view = split.views[focused]!
  const page = view.page

  // 배율은 PDF 실제 크기 기준이다: 100% = 종이 크기 그대로(1pt = 96/72 CSS px, 가장 넓은 쪽 기준).
  // 폭 맞춤·쪽 맞춤은 창 크기가 바뀌어도 계속 맞도록 '맞춤' 상태로 따로 둔다. 칸마다 창 크기가 달라 칸마다 셈한다.
  const referenceWidthPx = useMemo(
    () => Math.max(1, ...(meta?.pageSizes ?? []).map(([width]) => width)) * (96 / 72),
    [meta],
  )
  const zoomFor = (target: SplitView) => {
    const fittedWidth = target.viewport.width - 24
    // PdfPane 의 배율(폭 맞춤 = 100) 1 이 실제 크기 배율로 얼마인가
    const zoomScale = fittedWidth > 0 && meta !== null ? fittedWidth / referenceWidthPx : 0
    const paneZoom = (() => {
      if (zoomScale <= 0 || target.zoom.fit === 'width') return 100
      if (target.zoom.fit === 'page' || target.zoom.fit === 'height') {
        const pageSize = meta?.pageSizes[target.page - 1] ?? meta?.pageSizes[0]
        if (pageSize === undefined) return 100
        // 두·세 장 보기면 한 줄(쪽 여러 장)을 창에 맞춘다
        const size = [pageSize[0] * spreadColumns(props.pdfViewPrefs.spread), pageSize[1]] as const
        return target.zoom.fit === 'page' ? pageFitZoom(size, target.viewport) : pageHeightFitZoom(size, target.viewport)
      }
      return target.zoom.actual / zoomScale
    })()
    return { zoomScale, paneZoom, zoom: zoomScale > 0 ? Math.round(paneZoom * zoomScale) : 100 }
  }
  const zoomForRef = useRef(zoomFor)
  zoomForRef.current = zoomFor
  const { zoom } = zoomFor(view)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setFocusedZoom = useCallback((zoomState: ZoomState | ((current: ZoomState) => ZoomState)) => {
    changeSplit((state) => withView(state, Math.min(state.focused, state.views.length - 1), (target) => ({
      ...target,
      zoom: typeof zoomState === 'function' ? zoomState(target.zoom) : zoomState,
    })))
  }, [changeSplit])
  const setZoom = useCallback((next: number | ((current: number) => number)) => {
    const value = typeof next === 'function' ? next(zoomRef.current) : next
    setFocusedZoom({ fit: null, actual: clampZoom(value) })
  }, [setFocusedZoom])
  const fitWidth = useCallback(() => setFocusedZoom((current) => ({ ...current, fit: 'width' })), [setFocusedZoom])

  /** 칸마다 한 번 만들어 두는 손잡이(PdfPane 의 효과가 매번 다시 돌지 않게) */
  const cellHandlers = useMemo(() => Array.from({ length: MAX_SPLIT_CELLS }, (_, index) => ({
    onPageChange: (next: number) => changeSplit((state) => withView(state, index, (target) => (target.page === next ? target : { ...target, page: next }))),
    onViewportChange: (next: Viewport) => changeSplit((state) => withView(state, index, (target) => (
      target.viewport.width === next.width && target.viewport.height === next.height ? target : { ...target, viewport: next }
    ))),
    onZoomChange: (value: number) => changeSplit((state) => withView(state, index, (target) => {
      const scale = zoomForRef.current(target).zoomScale
      return { ...target, zoom: { fit: null, actual: clampZoom(scale > 0 ? value * scale : value) } }
    })),
    onFocus: () => changeSplit((state) => (state.focused === index || index >= state.views.length ? state : { ...state, focused: index })),
  })), [changeSplit])

  /** 화면 나누기 배치를 바꾼다. 새 칸은 지금 고른 칸과 같은 쪽·배율에서 출발한다 */
  const setSplitLayout = useCallback((id: PdfSplitLayoutId) => {
    changeSplit((state) => {
      if (state.layout === id) return state
      const layout = pdfSplitLayout(id)
      const base = state.views[Math.min(state.focused, state.views.length - 1)]!
      const views = layout.cells.map((_, index) => state.views[index]
        ?? { ...base, request: { page: base.page, nonce: 0 }, viewport: { width: 0, height: 0 } })
      return {
        layout: id,
        cols: state.cols.length === layout.cols ? state.cols : evenFractions(layout.cols),
        rows: state.rows.length === layout.rows ? state.rows : evenFractions(layout.rows),
        views,
        focused: Math.min(state.focused, views.length - 1),
      }
    })
  }, [changeSplit])

  /** 칸 하나 닫기(X): 남은 칸에 맞는 배치로 바꾸고, 남은 칸은 보던 쪽을 그대로 연다 */
  const closeSplitCellAt = useCallback((index: number) => {
    changeSplit((state) => {
      if (state.views.length <= 1) return state
      const { layout: nextId, keep } = closeSplitCell(state.layout, index)
      const layout = pdfSplitLayout(nextId)
      const nonce = Date.now()
      const views = keep.map((old) => {
        const target = state.views[old]!
        return { ...target, request: { page: target.page, nonce } }
      })
      const focusedOld = Math.min(state.focused, state.views.length - 1)
      const focusedNew = Math.max(keep.indexOf(focusedOld), 0)
      return { layout: nextId, cols: evenFractions(layout.cols), rows: evenFractions(layout.rows), views, focused: focusedNew }
    })
  }, [changeSplit])

  // 칸 사이 구분선을 끌어 칸 크기를 바꾼다
  const splitRootRef = useRef<HTMLDivElement>(null)
  const dragDivider = (axis: 'col' | 'row', boundary: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const rect = splitRootRef.current?.getBoundingClientRect()
      if (rect === undefined || rect.width <= 0 || rect.height <= 0) return
      const at = axis === 'col' ? (moveEvent.clientX - rect.left) / rect.width : (moveEvent.clientY - rect.top) / rect.height
      changeSplit((state) => (axis === 'col'
        ? { ...state, cols: moveSplitBoundary(state.cols, boundary, at) }
        : { ...state, rows: moveSplitBoundary(state.rows, boundary, at) }))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      handle.removeEventListener('lostpointercapture', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
    handle.addEventListener('lostpointercapture', end)
  }
  const [pdfQuery, setPdfQuery] = useState('')
  const [searchJumpNonce, setSearchJumpNonce] = useState(0)
  const [markdownQuery, setMarkdownQuery] = useState('')
  const [toolMode, setToolMode] = useState<PdfToolMode>('text')
  // PDF 도구 창의 「가리기 도구 켜기」: 이 문서 칸을 편집 모드로
  useEffect(() => {
    const start = (event: Event) => {
      const target = (event as CustomEvent<{ docId?: string }>).detail?.docId
      if (target !== undefined && target === docId) setToolMode('edit')
    }
    window.addEventListener('iwae:start-overlay-edit', start)
    return () => window.removeEventListener('iwae:start-overlay-edit', start)
  }, [docId])
  // Markdown 화면 나누기(같은 문서를 칸마다 따로 스크롤). 첫 칸이 주 칸이다
  const [markdownSplit, setMarkdownSplitState] = useState<PdfSplitLayoutId>('single')
  const [markdownFractions, setMarkdownFractions] = useState({ cols: [1], rows: [1] })
  const setMarkdownSplit = useCallback((id: PdfSplitLayoutId) => {
    const layout = pdfSplitLayout(id)
    setMarkdownSplitState(id)
    setMarkdownFractions({ cols: evenFractions(layout.cols), rows: evenFractions(layout.rows) })
  }, [])
  const markdownSplitRef = useRef<HTMLDivElement | null>(null)
  const dragMarkdownDivider = (axis: 'col' | 'row', boundary: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const box = markdownSplitRef.current?.getBoundingClientRect()
      if (box === undefined || box.width <= 0 || box.height <= 0) return
      const at = axis === 'col' ? (moveEvent.clientX - box.left) / box.width : (moveEvent.clientY - box.top) / box.height
      setMarkdownFractions((current) => axis === 'col'
        ? { ...current, cols: moveSplitBoundary(current.cols, boundary, at) }
        : { ...current, rows: moveSplitBoundary(current.rows, boundary, at) })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const [printOpen, setPrintOpen] = useState(false)
  const [searchOptions, setSearchOptions] = useState<PdfSearchOptions>({ caseSensitive: false, wholeWord: false })

  const search = usePdfSearch({
    docId,
    pageCount: meta?.pageCount ?? 0,
    query: pdfQuery,
    options: searchOptions,
    // 지금 보는 쪽부터 찾아 가고, 끝까지 가면 앞으로 돌아온다
    startPage: Math.max(page - 1, 0),
  })
  const activeSearchMatch = search.activeIndex < 0 ? undefined : search.matches[search.activeIndex]
  // 왼쪽 바 검색 결과를 절별로 묶을 목차(검색 칸을 붙였을 때만 읽는다)
  const searchDocked = props.searchSlot != null
  const [searchOutline, setSearchOutline] = useState<Awaited<ReturnType<typeof pdfOutline>>>([])
  useEffect(() => {
    setSearchOutline([])
    if (docId === null || !searchDocked) return
    let alive = true
    pdfOutline(docId).then((outline) => { if (alive) setSearchOutline(outline) }).catch(() => { /* 목차 없이 쪽만 보인다 */ })
    return () => { alive = false }
  }, [docId, searchDocked])

  /** 위·아래 막대, 사이드바, 검색이 옮기는 것은 고른 칸이다 */
  const requestPage = useCallback((next: number) => {
    changeSplit((state) => withView(state, Math.min(state.focused, state.views.length - 1), (target) => ({
      ...target,
      page: next,
      request: { page: next, nonce: target.request.nonce + 1 },
    })))
  }, [changeSplit])

  // 같은 패널에서 다른 문서로 바뀌면 그 문서의 시작 쪽으로 간다. 전에 보던 PDF 면 나눠 둔 화면·쪽을 그대로 되살린다.
  const previousDocId = useRef<string | null>(docId)
  useEffect(() => {
    const changed = previousDocId.current !== docId
    previousDocId.current = docId
    const remembered = docId !== null && splits[docId] !== undefined
    if (docId !== null && pendingPageRef.current?.docId === docId) {
      const next = startPage(docId)
      pendingPageRef.current = null
      if (!changed) return
      if (!remembered && peekInitialZoom(docId) === null) fitWidth()
      requestPage(next)
      return
    }
    if (!changed || docId === null || remembered) return
    // 다른 창에서 돌아온 문서는 그 창의 배율을 이어 간다
    if (peekInitialZoom(docId) === null) fitWidth()
    requestPage(startPage(docId))
    // startPage 는 ref 만 읽는다. splits 는 문서가 바뀐 때만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, pendingPageRef, requestPage])

  useEffect(() => {
    if (docId === null || previousDocId.current !== docId) return
    recordReadingPosition(docId, page)
  }, [docId, page, recordReadingPosition])

  useEffect(() => {
    onViewChange(paneId, docId === null ? null : { docId, page })
  }, [docId, onViewChange, page, paneId])
  useEffect(() => () => onViewChange(paneId, null), [onViewChange, paneId])

  useEffect(() => {
    const getZoom = () => splitRef.current.views[Math.min(splitRef.current.focused, splitRef.current.views.length - 1)]?.zoom ?? null
    controllersRef.current[paneId] = { docId, requestPage, getZoom }
    return () => {
      if (controllersRef.current[paneId]?.requestPage === requestPage) delete controllersRef.current[paneId]
    }
  }, [controllersRef, docId, paneId, requestPage])

  // 검색 결과로 옮기는 것은 PdfPane 이 한다(찾은 글자 자리로). 여기서 쪽 이동을 걸면 쪽 맨 위로 다시 튄다.
  // PDF 가 아직 그려지지 않은 Markdown 등은 여기 해당이 없다

  /** 쪽 칸에 친 절·표·그림 번호로 간다. 찾은 제목 줄은 칠해 둔다 */
  const goto = useCallback(async (text: string) => {
    if (meta === null) return false
    const target = parseGoto(text)
    if (target === null) {
      announceAction(t('알 수 없는 위치입니다: {text} (예: 81, 5.1.9.3, Table 52)', { text }))
      return false
    }
    const id = meta.docId
    const hit = await resolveGoto(target, {
      pageCount: meta.pageCount,
      outline: () => pdfOutline(id),
      pageText: (index) => pageTextIndex(id, index).then((pageIndex) => pageIndex.text),
    })
    if (hit === null) {
      announceAction(t('이 문서에서 찾지 못했습니다: {text}', { text }))
      return false
    }
    jumpToHitRef.current(hit)
    return true
  }, [meta])
  const jumpToHitRef = useRef<(hit: GotoHit) => void>(() => undefined)

  /** 찾은 자리로 가서(점프 기록에 남는다) 그 범위를 칠한다 */
  const jumpToHit = useCallback((hit: GotoHit) => {
    if (meta === null) return
    const id = meta.docId
    props.jumpToPage(hit.pageIndex + 1)
    if (hit.range === undefined) return
    const range = hit.range
    void pageTextIndex(id, hit.pageIndex)
      .then((index) => props.onAnchorCreated(buildAnchor(id, hit.pageIndex, index, range[0], range[1])))
      .catch(() => undefined)
  }, [meta, props])
  const hostRef = useRef<HTMLDivElement>(null)
  jumpToHitRef.current = jumpToHit

  // Ctrl+G: 마지막으로 만진 문서 패널의 쪽 칸으로
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!props.shortcutTarget) return
    const focusGoto = () => rootRef.current?.querySelector<HTMLInputElement>('input.bottombar-goto')?.focus()
    window.addEventListener('iwae:goto', focusGoto)
    return () => window.removeEventListener('iwae:goto', focusGoto)
  }, [props.shortcutTarget])
  // Ctrl+P: 마지막으로 만진 PDF 의 인쇄 창
  const canPrint = (tab.kind === 'pdf' && meta !== null) || tab.kind === 'markdown'
  /** Markdown 은 보이는 본문을 그대로 인쇄한다 */
  const printMarkdownTab = () => {
    const html = rootRef.current?.querySelector('.markdown-pane')?.innerHTML
    if (html !== undefined) printMarkdown(props.fullTitle, html)
  }
  useEffect(() => {
    if (!props.shortcutTarget || !canPrint) return
    const openPrint = () => (tab.kind === 'markdown' ? printMarkdownTab() : setPrintOpen(true))
    window.addEventListener('iwae:print', openPrint)
    return () => window.removeEventListener('iwae:print', openPrint)
  }, [canPrint, props.shortcutTarget])

  const isPdf = tab.kind === 'pdf'
  // 이 문서의 책갈피 핀(칸마다 같은 핀이 막대 옆에 꽂힌다)
  const docPins = useMemo(() => (docId === null ? [] : props.pins.filter((pin) => pin.docId === docId)), [docId, props.pins])
  const { onAddPin } = props
  const addPin = useCallback((page: number, y: number, title: string) => (docId === null ? '' : onAddPin(docId, page, y, title)), [docId, onAddPin])
  const toolbar = (
    <PaneToolbar
      kind={tab.kind === 'markdown' ? 'markdown' : 'pdf'}
      mode={toolMode}
      onModeChange={setToolMode}
      // 검색은 PDF 와 같이 왼쪽 바 「검색」 보기에서 한다(도구줄에는 검색 칸이 없다)
      fullscreen={props.fullscreen}
      onToggleFullscreen={props.onToggleFullscreen}
      pageLayout={tab.kind === 'pdf' ? { spread: props.pdfViewPrefs.spread, continuous: props.pdfViewPrefs.continuous !== false } : undefined}
      onPageLayoutChange={(layout) => props.onPdfViewPrefsChange({ ...props.pdfViewPrefs, ...layout })}
      versionLabel={tab.kind === 'pdf' ? props.versionLabel : undefined}
      onOpenVersions={tab.kind === 'pdf' ? props.onOpenVersions : undefined}
      sourceCount={props.sourceCount ?? 0}
      onOpenSources={props.onOpenSources}
      github={tab.kind === 'markdown' ? props.github : undefined}
      onCopyFile={props.onCopyFile}
      onEditPages={tab.kind === 'pdf' && docId !== null && props.onEditPages !== undefined ? () => props.onEditPages?.(docId) : undefined}
      onPdfTools={tab.kind === 'pdf' && docId !== null && props.onEditPages !== undefined ? () => runAppCommand('pdfTools', { docId }) : undefined}
      shortcutsEnabled={props.shortcutTarget}
      cleanView={props.pdfViewPrefs.clean === true}
      onCleanViewChange={(clean) => props.onPdfViewPrefsChange({ ...props.pdfViewPrefs, clean })}
      splitLayout={tab.kind === 'pdf' && meta !== null ? split.layout : tab.kind === 'markdown' ? markdownSplit : undefined}
      onSplitLayoutChange={tab.kind === 'markdown' ? setMarkdownSplit : setSplitLayout}
    />
  )
  // Markdown 뷰어의 배율·절(아래 막대). 배율은 Markdown 모두에 하나로 기억한다
  const [markdownZoom, setMarkdownZoomState] = useState(() => {
    try { const saved = Number(window.localStorage.getItem('iwae:md-zoom:v1')); return saved >= 50 && saved <= 300 ? saved : 100 } catch { return 100 }
  })
  // 폭 맞춤(PDF 처럼 처음엔 폭 맞춤). 배율을 직접 바꾸면 풀린다
  const [markdownFit, setMarkdownFitState] = useState(() => {
    try { return window.localStorage.getItem('iwae:md-fit:v1') !== 'off' } catch { return true }
  })
  const setMarkdownFit = useCallback((on: boolean) => {
    setMarkdownFitState(on)
    try { window.localStorage.setItem('iwae:md-fit:v1', on ? 'on' : 'off') } catch { /* 이번 실행에만 */ }
  }, [])
  const setMarkdownZoom = useCallback((value: number) => {
    const next = Math.min(Math.max(Math.round(value), 50), 300)
    setMarkdownZoomState(next)
    setMarkdownFit(false)
    try { window.localStorage.setItem('iwae:md-zoom:v1', String(next)) } catch { /* 이번 실행에만 */ }
  }, [setMarkdownFit])
  // 폭 맞춤이 잰 배율(저장하지 않는다 — 다음에도 창 폭에 맞춰 다시 잰다)
  const onMarkdownFitZoom = useCallback((value: number) => setMarkdownZoomState(value), [])
  const [markdownSections, setMarkdownSections] = useState({ current: 0, count: 1 })
  const onMarkdownSectionsChange = useCallback((current: number, count: number) => setMarkdownSections((value) => (value.current === current && value.count === count ? value : { current, count })), [])
  const [markdownSectionRequest, setMarkdownSectionRequest] = useState<{ index: number; nonce: number } | null>(null)
  // Markdown 검색(왼쪽 바 「검색」 보기)
  const [markdownHits, setMarkdownHits] = useState<readonly MarkdownSearchHit[]>([])
  const [markdownHitIndex, setMarkdownHitIndex] = useState(-1)
  const [markdownSearchJump, setMarkdownSearchJump] = useState<{ index: number; nonce: number } | null>(null)
  const onMarkdownSearchHits = useCallback((hits: readonly MarkdownSearchHit[], startIndex: number) => {
    setMarkdownHits(hits)
    setMarkdownHitIndex(startIndex)
    if (startIndex >= 0) setMarkdownSearchJump({ index: startIndex, nonce: Date.now() })
  }, [])
  const selectMarkdownHit = (index: number) => {
    setMarkdownHitIndex(index)
    setMarkdownSearchJump({ index, nonce: Date.now() })
  }
  // 왼쪽 바 「목차」(App)와 절을 주고받는다
  useEffect(() => {
    if (tab.kind !== 'markdown') return
    window.dispatchEvent(new CustomEvent('iwae:md-section-state', { detail: { path: tab.id, current: markdownSections.current } }))
  }, [markdownSections, tab.id, tab.kind])
  useEffect(() => {
    if (tab.kind !== 'markdown') return
    const go = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; index: number }>).detail
      if (detail?.path === tab.id) setMarkdownSectionRequest({ index: detail.index, nonce: Date.now() })
    }
    window.addEventListener('iwae:md-section-go', go)
    return () => window.removeEventListener('iwae:md-section-go', go)
  }, [tab.id, tab.kind])
  const markdownBottomBar = tab.kind === 'markdown' ? (
    <PdfBottomBar
      zoomPercent={Math.round(markdownZoom)}
      page={markdownSections.current + 1}
      pageCount={markdownSections.count}
      onZoomIn={() => setMarkdownZoom(stepZoom(markdownZoom, 1))}
      onZoomOut={() => setMarkdownZoom(stepZoom(markdownZoom, -1))}
      onFitWidth={() => setMarkdownFit(true)}
      onFitPage={() => setMarkdownFit(true)}
      onActualSize={() => setMarkdownZoom(100)}
      onZoomChange={setMarkdownZoom}
      onPageChange={(value) => setMarkdownSectionRequest({ index: Math.max(value - 1, 0), nonce: Date.now() })}
      canGoBack={props.canGoBack}
      canGoForward={props.canGoForward}
      onBack={props.onBack}
      onForward={props.onForward}
    />
  ) : undefined
  const bottomBar = isPdf ? (
    <PdfBottomBar
      zoomPercent={zoom}
      page={meta === null ? 0 : page}
      pageCount={meta?.pageCount ?? 0}
      onZoomIn={() => setZoom((value) => stepZoom(value, 1))}
      onZoomOut={() => setZoom((value) => stepZoom(value, -1))}
      onFitWidth={fitWidth}
      onFitPage={() => setFocusedZoom((current) => ({ ...current, fit: 'page' }))}
      onFitHeight={() => setFocusedZoom((current) => ({ ...current, fit: 'height' }))}
      onActualSize={() => setFocusedZoom({ fit: null, actual: 100 })}
      onZoomChange={setZoom}
      onPageChange={requestPage}
      canGoBack={props.canGoBack}
      canGoForward={props.canGoForward}
      onBack={props.onBack}
      onForward={props.onForward}
      onGoto={goto}
      extraControls={(
        <PdfViewMenu
          prefs={props.pdfViewPrefs}
          rotation={meta === null ? 0 : props.rotations[meta.docId] ?? 0}
          onPrefsChange={props.onPdfViewPrefsChange}
          onRotate={() => {
            if (meta === null) return
            const id = meta.docId
            props.onRotationsChange((current) => ({ ...current, [id]: nextRotation(current[id] ?? 0) }))
          }}
        />
      )}
    />
  ) : undefined

  return (
    <div className="pane-doc" ref={rootRef}>
      {printOpen && meta !== null ? (
        <PdfPrintDialog
          pageCount={meta.pageCount}
          page={page}
          docId={meta.docId}
          pageSizes={meta.pageSizes}
          onClose={() => setPrintOpen(false)}
          onPrint={(pages, options) => {
            setPrintOpen(false)
            void printPdfPages(meta.docId, pages, props.fullTitle, options, meta.pageSizes[pages[0] ?? 0], { pageSizes: meta.pageSizes, overlays: props.overlays ?? [] }).catch(() => undefined)
          }}
        />
      ) : null}
      <PaneShell
        state={props.state}
        emptyHint=""
        placeholder={props.placeholder}
        toolbar={toolbar}
        bottomBar={bottomBar ?? markdownBottomBar}
        renderBody={() => {
          const renderMarkdownCell = (index: number) => props.markdownSource === undefined ? null : (
              <MarkdownPane
                key={index}
                primary={index === 0}
                path={tab.id}
                sourceFileId={props.markdownSourceFileId}
                vaultRoot={props.vaultRoot}
                onOpenDocument={props.onOpenMarkdownPath}
                onExternalLink={props.onExternalLink}
                title={tab.title}
                source={props.markdownSource}
                theme={props.markdownTheme}
                interactionMode={toolMode}
                onInteractionModeChange={setToolMode}
                boxHighlights={props.persistentHighlights}
                onBoxHighlightCreated={props.onPersistentHighlightCreated}
                onBoxHighlightUpdated={props.onPersistentHighlightUpdated}
                onBoxHighlightRemoved={props.onPersistentHighlightRemoved}
                overlays={props.overlays}
                onOverlayAdd={props.onOverlayAdd === undefined ? undefined : (overlay) => props.onOverlayAdd?.(tab.id, overlay)}
                onOverlayUpdate={props.onOverlayUpdate === undefined ? undefined : (id, patch) => props.onOverlayUpdate?.(tab.id, id, patch)}
                onOverlayRemove={props.onOverlayRemove === undefined ? undefined : (id) => props.onOverlayRemove?.(tab.id, id)}
                onMemoJump={props.onMemoJump}
                docTitles={props.docTitles}
                onSearchHits={onMarkdownSearchHits}
                searchJump={markdownSearchJump}
                pins={props.pins.filter((pin) => pin.docId === tab.id)}
                onAddPin={(page, y, pinTitle) => props.onAddPin(tab.id, page, y, pinTitle)}
                onUpdatePin={props.onUpdatePin}
                onMovePin={props.onMovePin}
                onRemovePin={props.onRemovePin}
                searchQuery={markdownQuery}
                onTranslateSelection={props.onTranslateMarkdownSelection}
                onSearchDocuments={props.onSearchDocumentsText}
                clean={props.pdfViewPrefs.clean === true}
                onSendTranslatedSelection={props.onSendTranslatedMarkdownSelection}
                persistentHighlights={props.markdownHighlights}
                onPersistentHighlightCreated={props.onMarkdownHighlightCreated}
                onPersistentHighlightRemoved={props.onMarkdownHighlightRemoved}
                sourceHighlights={props.sourceHighlights}
                jumpRequest={props.markdownJumpRequest?.path === tab.id ? props.markdownJumpRequest : null}
                onJumpHandled={props.onMarkdownJumpHandled}
                zoom={markdownZoom}
                onZoomChange={setMarkdownZoom}
                fitWidth={markdownFit && index === 0}
                onFitZoom={onMarkdownFitZoom}
                onSectionsChange={onMarkdownSectionsChange}
                sectionRequest={markdownSectionRequest}
              />
          )
          if (tab.kind === 'markdown') {
            const source = props.markdownSource
            return source === undefined ? null : (
              <>
              {props.searchSlot != null && props.shortcutTarget ? createPortal(
                <MarkdownSearchPanel
                  query={markdownQuery}
                  onQueryChange={setMarkdownQuery}
                  hits={markdownHits}
                  activeIndex={markdownHitIndex}
                  onSelect={selectMarkdownHit}
                />,
                props.searchSlot,
              ) : null}
              {(() => {
                const layout = pdfSplitLayout(markdownSplit)
                if (layout.cells.length === 1) return renderMarkdownCell(0)
                return (
                  <div ref={markdownSplitRef} className="pdf-split pdf-split-multi markdown-split" style={{ gridTemplateColumns: markdownFractions.cols.map((value) => `minmax(0, ${value}fr)`).join(' '), gridTemplateRows: markdownFractions.rows.map((value) => `minmax(0, ${value}fr)`).join(' ') }}>
                    {layout.cells.map((place, index) => (
                      <div key={index} className="pdf-split-cell markdown-split-cell" style={{ gridColumn: `${place.col + 1} / span ${place.colSpan}`, gridRow: `${place.row + 1} / span ${place.rowSpan}` }}>
                        <button type="button" className="pdf-split-cell-close" aria-label={t('{n}번 칸 닫기', { n: index + 1 })} title={t('칸 닫기')} onClick={() => setMarkdownSplit(closeSplitCell(markdownSplit, index).layout)}>
                          <X size={12} weight="bold" aria-hidden="true" />
                        </button>
                        {renderMarkdownCell(index)}
                      </div>
                    ))}
                    {splitDividers(layout).map((divider) => {
                      const across = divider.axis === 'col' ? markdownFractions.rows : markdownFractions.cols
                      const along = divider.axis === 'col' ? markdownFractions.cols : markdownFractions.rows
                      const position = fractionOffset(along, divider.boundary)
                      const start = fractionOffset(across, divider.start)
                      const end = fractionOffset(across, divider.end)
                      return (
                        <div
                          key={`${divider.axis}-${divider.boundary}-${divider.start}`}
                          className={`pdf-split-divider pdf-split-divider-${divider.axis}`}
                          role="separator"
                          aria-orientation={divider.axis === 'col' ? 'vertical' : 'horizontal'}
                          aria-label={t('칸 크기 조절')}
                          style={divider.axis === 'col'
                            ? { left: `${position * 100}%`, top: `${start * 100}%`, height: `${(end - start) * 100}%` }
                            : { top: `${position * 100}%`, left: `${start * 100}%`, width: `${(end - start) * 100}%` }}
                          onPointerDown={dragMarkdownDivider(divider.axis, divider.boundary)}
                        />
                      )
                    })}
                  </div>
                )
              })()}
              </>
            )
          }
          // iwae:// 는 이미 열린 문서만 그린다. 메타가 없으면 자리표시자로 물러난다.
          if (meta === null) return null
          return (
            // 마우스 옆 단추(뒤로·앞으로)는 App 이 창 전체에서 받는다
            <div className={`pdf-pane-host${props.pdfViewPrefs.clean === true ? ' pdf-clean-view' : ''}`} ref={hostRef}>
              <CrossRefPreview
                hostRef={hostRef}
                docId={meta.docId}
                pageCount={meta.pageCount}
                pageSizes={meta.pageSizes}
                enabled={toolMode === 'text'}
                onJump={jumpToHit}
              />
              {/* PDF 검색은 왼쪽 바(「PDF 검색」 보기)에 붙인다. 마지막으로 만진 문서 패널만 */}
              {props.searchSlot != null && props.shortcutTarget ? createPortal(
                <PdfSearchPanel
                  docked
                  outline={searchOutline}
                  query={pdfQuery}
                  onQueryChange={setPdfQuery}
                  search={search}
                  options={searchOptions}
                  onOptionsChange={setSearchOptions}
                  // 쪽 이동이 아니라 찾은 글자 자리로(PdfPane). 같은 결과를 다시 눌러도 다시 간다
                  onSelectMatch={() => setSearchJumpNonce((value) => value + 1)}
                  shortcutTarget={props.shortcutTarget}
                  pageSizes={meta.pageSizes}
                />,
                props.searchSlot,
              ) : null}
              {/* 화면 나누기: 같은 PDF 를 칸마다 다른 쪽으로 본다. 누른 칸이 위·아래 막대가 다루는 칸이 된다 */}
              <div
                ref={splitRootRef}
                className={`pdf-split${split.views.length > 1 ? ' pdf-split-multi' : ''}`}
                data-split-layout={split.layout}
                style={{
                  gridTemplateColumns: split.cols.map((value) => `minmax(0, ${value}fr)`).join(' '),
                  gridTemplateRows: split.rows.map((value) => `minmax(0, ${value}fr)`).join(' '),
                }}
              >
                {splitLayout.cells.map((place, index) => {
                  const cell = split.views[index]
                  const handlers = cellHandlers[index]
                  if (cell === undefined || handlers === undefined) return null
                  const cellZoom = zoomFor(cell)
                  return (
                    <div
                      key={index}
                      className={`pdf-split-cell${split.views.length > 1 && index === focused ? ' pdf-split-cell-focused' : ''}`}
                      data-split-cell={index}
                      style={{ gridColumn: `${place.col + 1} / span ${place.colSpan}`, gridRow: `${place.row + 1} / span ${place.rowSpan}` }}
                      onPointerDownCapture={handlers.onFocus}
                    >
                  {split.views.length > 1 ? (
                    <button
                      type="button"
                      className="pdf-split-cell-close"
                      aria-label={t('{n}번 칸 닫기', { n: index + 1 })}
                      title={t('칸 닫기')}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => closeSplitCellAt(index)}
                    >
                      <X size={12} weight="bold" aria-hidden="true" />
                    </button>
                  ) : null}
                  <PdfPane
                    // 쪽 편집으로 내용이 바뀌면(해시가 바뀜) 새로 그린다 — 글자 위치 캐시가 예전 쪽 것이다
                    key={`${meta.docId}:${meta.sha256}:${index}`}
                    primary={index === focused}
                    inSplit
                    docId={meta.docId}
                    title={meta.title}
                    pageSizes={meta.pageSizes}
                    hasText={meta.hasText}
                    zoomPercent={cellZoom.paneZoom}
                    zoomScale={cellZoom.zoomScale}
                    onPageChange={handlers.onPageChange}
                    pageRequest={cell.request}
                    viewKey={`${tab.id}:${index}`}
                    searchJumpNonce={searchJumpNonce}
                    onViewportChange={handlers.onViewportChange}
                    onZoomChange={handlers.onZoomChange}
                    highlightAnchor={props.draftHighlight?.docId === meta.docId ? props.draftHighlight : null}
                    sourceHighlights={props.sourceHighlights.filter(
                      (source): source is VisiblePdfSourceReference => source.relation !== 'markdown-excerpt',
                    )}
                    searchMatches={search.matches}
                    activeSearchMatchId={activeSearchMatch?.id ?? null}
                    interactionMode={toolMode}
                    onInteractionModeChange={setToolMode}
                    persistentHighlights={props.persistentHighlights}
                    onPersistentHighlightCreated={props.onPersistentHighlightCreated}
                    onPersistentHighlightRemoved={props.onPersistentHighlightRemoved}
                    onPersistentHighlightUpdated={props.onPersistentHighlightUpdated}
                    onPersistentHighlightsPatched={props.onPersistentHighlightsPatched}
                    onMemoJump={props.onMemoJump}
                    docTitles={props.docTitles}
                    spread={props.pdfViewPrefs.spread}
                    continuous={props.pdfViewPrefs.continuous !== false}
                    tone={props.pdfViewPrefs.tone ?? 'none'}
                    onSendToCanvas={props.onSendToCanvas}
                    onCopyWithSource={props.onCopyWithSource}
                    onSearchDocuments={props.onSearchDocuments}
                    onTranslateSelection={props.onTranslateSelection}
                    onSendTranslatedSelection={props.onSendTranslatedSelection}
                    onAnchorCreated={props.onAnchorCreated}
                    onLinkNavigate={props.jumpToPage}
                    flashHighlightId={props.flashHighlightId}
                    invert={props.pdfViewPrefs.invert}
                    pins={docPins}
                    overlays={props.overlays}
                    onOverlayAdd={props.onOverlayAdd === undefined ? undefined : (overlay) => props.onOverlayAdd?.(meta.docId, overlay)}
                    onOverlayUpdate={props.onOverlayUpdate === undefined ? undefined : (id, patch) => props.onOverlayUpdate?.(meta.docId, id, patch)}
                    onOverlayRemove={props.onOverlayRemove === undefined ? undefined : (id) => props.onOverlayRemove?.(meta.docId, id)}
                    onAddPin={addPin}
                    onUpdatePin={props.onUpdatePin}
                    onMovePin={props.onMovePin}
                    onRemovePin={props.onRemovePin}
                    rotation={props.rotations[meta.docId] ?? 0}
                    onExternalLink={props.onExternalLink}
                  />
                    </div>
                  )
                })}
                {splitDividers(splitLayout).map((divider) => {
                  const along = divider.axis === 'col' ? split.cols : split.rows
                  const across = divider.axis === 'col' ? split.rows : split.cols
                  const at = `${fractionOffset(along, divider.boundary) * 100}%`
                  const from = `${fractionOffset(across, divider.start) * 100}%`
                  const size = `${(fractionOffset(across, divider.end) - fractionOffset(across, divider.start)) * 100}%`
                  return (
                    <div
                      key={`${divider.axis}:${divider.boundary}:${divider.start}`}
                      className={`pdf-split-divider pdf-split-divider-${divider.axis}`}
                      role="separator"
                      aria-orientation={divider.axis === 'col' ? 'vertical' : 'horizontal'}
                      aria-label={t('칸 크기 조절')}
                      style={divider.axis === 'col' ? { left: at, top: from, height: size } : { top: at, left: from, width: size }}
                      onPointerDown={dragDivider(divider.axis, divider.boundary)}
                    />
                  )
                })}
              </div>
            </div>
          )
        }}
      />
    </div>
  )
}
