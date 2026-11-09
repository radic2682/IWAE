import { ChatTeardropText } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { useIsNoteHostPane } from '../app/noteHostPane'
import { MEMO_BAR_WIDTH, useMemoBarWidth } from './memoBarWidth'
import { NoteBarHeader } from './NoteBarHeader'
import { useHighlightTool } from './highlightToolStore'
import { useOverlayTool, useToolStyle } from './overlayToolStore'
import { HighlighterStrip } from './HighlighterTool'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type UIEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { PdfPins, PinHead, type PlacedPin, type PdfPinPatchInput } from './PdfPins'
import type { PdfBookmark } from '../core/pdfBookmarks'
import type { Anchor } from '../core/anchor'
import type { PageTextIndex } from '../core/textIndex'

const EMPTY_PAGE_TEXT_INDEX: PageTextIndex = { text: '', chars: [] }
import type { VisiblePdfSourceReference } from '../core/workspaceSources'
import type { PdfSearchMatch } from '../core/pdfSearch'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { prewarmPdfTextDetector } from './ocrTextDetector'
import { getAppPrefs } from '../app/appPrefs'
import { layoutPages, layoutSpread, pageUnitAt, spreadHeight, totalHeight, visibleRange, type SpreadBox } from './pageLayout'
import { spreadColumns, type PdfRotation, type PdfSpread } from '../core/pdfViewPrefs'
import { renderWidthFor } from './renderWidth'
import { PageImage, prefetchPreviews } from './PageImage'
import { stepZoom } from '../core/pdfZoom'
import { pageTextIndex, pdfOutline, pdfPageLinks, type PdfLink, type PdfOutlineEntry } from '../bridge/pdf'
import { SelectionLayer, type PdfHighlightColor, type PdfInteractionMode } from './SelectionLayer'
import { LinkLayer } from './LinkLayer'
import { HighlightPopover } from './HighlightPopover'
import { MemoColumn, MemoFormatBar, MemoFormatSlotContext, type MemoContent, type MemoTarget } from './MemoColumn'
import { PdfBoxMemos } from './PdfBoxMemos'
import { PdfOverlayLayer, type OverlayStyle, type OverlayTool } from './PdfOverlayLayer'
import { PdfFloatPalette, PdfOverlayPalette } from './PdfOverlayPalette'
import type { OverlayPatch, PdfOverlay } from '../core/pdfOverlays'
import { announceAction } from '../app/actionFeedback'
import { BOX_DEFAULT_WIDTH, placeBoxMemo } from '../core/boxMemo'
import { MemoListView } from './MemoListView'
import { useMemoBarVisible, setMemoBarVisible } from './memoStore'
import { useMemoNoteApi } from './memoNoteContext'
import { NoteFlow, type NoteFlowItem } from './NoteFlow'
import { addMemoRef, insertBlock, memoBlock, memoHighlightIds, moveBlockBefore, removeBlock, removeMemoRef, sectionBlock, setMemoTicket, textBlock, updateSection, updateTextBlock, type MemoNote, type MemoNoteBlock, type MemoTicket } from '../core/memoNote'
import { createTextExcerptSelection } from '../core/pdfExcerpt'
import { createPersistentPdfHighlight, updatePersistentPdfHighlight, type PersistentPdfHighlight, type PersistentPdfHighlightPatch } from './persistentHighlight'
import type { PdfSelectionTranslation } from './SelectionActions'
import { createFrameScheduler } from '../core/frameScheduler'
import '../ui/pdf-followup.css'
import { t } from '../i18n'

/**
 * 페이지 사이의 간격(px).
 *
 * **layoutPages 와 totalHeight 에 같은 값을 줘야 한다.** totalHeight 는
 * layoutPages 의 결과를 믿지 않고 gap 을 스스로 다시 더한다 — 두 곳에 다른
 * 값이 들어가면 스크롤 막대의 길이와 페이지의 실제 위치가 조금씩 어긋나고,
 * 1,000쪽 문서의 끝에서는 그 오차가 페이지 수만큼 쌓여 마지막 장에 닿지
 * 못한다. 그래서 상수를 하나만 두고 둘 다 여기서 받아 간다.
 */
const PAGE_GAP = 12
const PAGE_GUTTER = 12

/**
 * 보이는 범위 앞뒤로 더 그릴 페이지 수.
 *
 * 0 이면 스크롤한 그 순간에야 다음 장을 요청하게 되어, 렌더가 끝날 때까지
 * 빈 칸을 보게 된다(Rust 쪽 렌더가 13–29ms 에 큐 대기가 더 붙는다).
 * 1 이면 다음 장이 이미 와 있다. 크게 잡을수록 헛되이 큐를 채우므로
 * — 그 큐에는 취소가 없다 — 한 장이면 충분하다.
 */
/** 스크롤 막대 목차는 1 → 1.1 → 1.1.1 까지 */
const SCROLLBAR_OUTLINE_DEPTH = 2
/** 막대 옆 제목 사이의 최소 간격(px). 이보다 가까우면 작은 단계 제목은 눈금만 남긴다 */
const SCROLLBAR_LABEL_GAP = 19

const OVERSCAN = 2
/** 패널 구분선을 끄는 동안 PDF 폭 맞춤 간격(ms) */
const RESIZE_THROTTLE_MS = 120
/** 화면 앞뒤로 미리보기를 미리 받아 둘 쪽 수 */
const PREVIEW_PREFETCH = 8
/** 메모 바 안에서 카드가 시작하는 자리(왼쪽 끝에서 선이 굽어 들어올 틈) */
const MEMO_CARD_INSET = 12

/**
 * 보기마다 마지막 스크롤 자리. 탭을 바꾸면 PdfPane 이 내려갔다 다시 올라오므로 컴포넌트 밖에 둔다.
 * 쪽 번호 + 그 쪽 안의 비율로 적어, 그 사이 창 폭·배율이 바뀌어도 같은 글 자리로 돌아온다.
 */
interface SavedPdfScroll {
  readonly page: number
  readonly fractionY: number
  readonly scrollLeft: number
  /** 적을 때 따르던 쪽 이동 요청. 돌아왔을 때 요청이 바뀌었으면 적어 둔 자리 대신 요청을 따른다 */
  readonly request: { readonly page: number; readonly nonce: number } | null
}
const savedPdfScrolls = new Map<string, SavedPdfScroll>()
const SAVED_PDF_SCROLL_LIMIT = 200

interface PdfPaneProps {
  /** pdf_open 이 돌려준 12자리 16진수 */
  docId: string
  /** 페이지별 (폭, 높이). 0-기반이고 길이가 곧 페이지 수다. */
  pageSizes: readonly (readonly [number, number])[]
  /** false 면 스캔본 */
  hasText: boolean
  title?: string
  zoomPercent?: number
  /** zoomPercent(폭 맞춤 = 100) 1 이 화면에 보이는 실제 크기 배율로 얼마인가. Ctrl+휠이 실제 배율 단계를 밟게 한다 */
  zoomScale?: number
  onPageChange?: (page: number) => void
  pageRequest?: { page: number; nonce: number }
  /**
   * 이 보기의 열쇠(탭 id + 칸 번호). 주면 다른 탭을 보고 돌아왔을 때 쪽 안의 스크롤 자리까지 되살린다.
   * 그 사이 새 쪽 이동 요청(pageRequest 가 바뀜)이 왔으면 요청을 따른다.
   */
  viewKey?: string
  /** 검색 결과를 눌렀다(같은 결과를 다시 눌러도 그 자리로 다시 간다) */
  searchJumpNonce?: number
  onViewportChange?: (viewport: Measured) => void
  onZoomChange?: (zoomPercent: number) => void
  /** 글자를 골랐다. null 이면 고른 것을 지웠다(메모로 바꾼 뒤 등) */
  onAnchorCreated?: (anchor: Anchor | null) => void
  onPersistentHighlightCreated?: (highlight: PersistentPdfHighlight) => void
  onPersistentHighlightRemoved?: (highlightId: string) => void
  persistentHighlights?: readonly PersistentPdfHighlight[]
  highlightAnchor?: Anchor | null
  sourceHighlights?: readonly VisiblePdfSourceReference[]
  searchMatches?: readonly PdfSearchMatch[]
  activeSearchMatchId?: string | null
  interactionMode?: PdfInteractionMode
  highlightColor?: PdfHighlightColor
  onInteractionModeChange?: (mode: PdfInteractionMode) => void
  onHighlightColorChange?: (color: PdfHighlightColor) => void
  onSendToCanvas?: (selection: PdfExcerptSelection) => void
  onCopyWithSource?: (selection: PdfExcerptSelection) => void
  onSearchDocuments?: (selection: PdfExcerptSelection) => void
  onTranslateSelection?: (selection: PdfExcerptSelection) => Promise<PdfSelectionTranslation | null>
  onSendTranslatedSelection?: (
    selection: PdfExcerptSelection,
    translation: PdfSelectionTranslation,
  ) => void
  /** 문서 안 링크를 눌렀다. 1-기반 쪽 번호 */
  onLinkNavigate?: (page: number) => void
  /** 외부 링크를 눌렀다. 여는 것은 확인을 받은 뒤 App 이 한다 */
  onExternalLink?: (uri: string) => void
  /** 한 쪽씩 / 두 쪽 펼침 */
  spread?: PdfSpread
  /** false 면 넘겨 보기: 한 화면에 한 쪽(두 장 보기면 한 쌍)만 두고 휠이 끝에 닿으면 다음 쪽으로 넘긴다 */
  continuous?: boolean
  /** 페이지 배경 색조. 야간은 invert 가 맡는다 */
  tone?: 'none' | 'sepia' | 'green'
  /** 화면에서만 돌린다. 돌아간 동안 선택·형광펜·링크는 쉰다 */
  rotation?: PdfRotation
  /** 페이지 그림의 색을 뒤집는다(어두운 테마용) */
  invert?: boolean
  /** 잠깐 깜빡일 형광펜. 주석 패널에서 고른 항목이다 */
  flashHighlightId?: string | null
  /** 형광펜 메모 창에서 색·메모를 고쳤다 */
  onPersistentHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  /** 여러 메모를 한 번에 고친다(순서 바꾸기·모두 접기). 저장은 한 번 */
  onPersistentHighlightsPatched?: (patches: ReadonlyArray<{ readonly id: string; readonly patch: PersistentPdfHighlightPatch }>) => void
  /** 다른 PDF 의 메모로 간다(노트 검색·메모만 보기에서). 같은 PDF 안은 PdfPane 이 직접 옮긴다 */
  onMemoJump?: (highlight: PersistentPdfHighlight) => void
  /** PDF 이름(노트 검색·메모만 보기에 쓴다) */
  docTitles?: Readonly<Record<string, string>>
  /**
   * 화면 나누기에서 지금 고른 칸인가. 메모 바·형광펜 도구는 이 칸 하나만 그린다(기본 true).
   * 나머지 칸은 같은 PDF 의 다른 쪽을 보여 주기만 한다
   */
  primary?: boolean
  /**
   * 화면 나누기 칸(.pdf-split 안) 안에 있다. 메모 바 자리는 칸들을 담은 상자가 비우므로
   * 스크롤 상자를 따로 줄이지 않는다
   */
  inSplit?: boolean
  /** 이 PDF 의 책갈피 핀. 스크롤 막대 옆에 꽂혀 보인다 */
  pins?: readonly PdfBookmark[]
  /** 막대 옆 흐린 핀을 눌러 새 핀을 꽂는다(쪽, 쪽 안의 높이 비율, 기본 이름). 새 핀 id 를 돌려준다 */
  onAddPin?: (page: number, y: number, title: string) => string
  onUpdatePin?: (id: string, patch: PdfPinPatchInput) => void
  /** PDF 위 편집(글 상자·선) 덮개와 그 변경 */
  overlays?: readonly PdfOverlay[]
  onOverlayAdd?: (overlay: PdfOverlay) => void
  onOverlayUpdate?: (id: string, patch: OverlayPatch) => void
  onOverlayRemove?: (id: string) => void
  /** 핀을 꾹 눌러 끌어 옮겼다(쪽, 쪽 안의 높이 0–1). 새 id 를 돌려준다 */
  onMovePin?: (id: string, page: number, y: number) => string
  onRemovePin?: (id: string) => void
}

/** 메모 열 닫기·열기 단추: 오른쪽 반을 칠한 네모(오른쪽 패널) */
/** 상자를 아직 못 잰 최초 렌더에서는 둘 다 0 이다. pageLayout 이 그 경우를 방어한다. */
interface Measured {
  width: number
  height: number
}

/**
 * 한 PDF 문서의 스크롤 뷰. `.pane-body` 를 채우고 스스로 스크롤한다.
 *
 * 이 파일의 핵심 성질은 하나다 — **보이지 않는 페이지의 `<img>` 는 DOM 에
 * 없다.** 1,000쪽을 다 얹으면 웹뷰가 1,000개의 요청을 걸고 그만큼의 비트맵을
 * 들고 있게 되어, 문서를 여는 것만으로 메모리가 페이지 수에 비례해 늘어난다.
 * 그래서 전체 높이만큼의 빈 상자 하나로 스크롤 막대를 만들고, 그 위에
 * visibleRange 가 돌려준 페이지만 절대 위치로 얹는다.
 */
export function pageFitZoom(pageSize: readonly [number, number], viewport: Measured): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 100
  const [pageWidth, pageHeight] = pageSize
  const widthFitHeight = (viewport.width * pageHeight) / pageWidth
  return Math.max(10, Math.min(100, Math.round((viewport.height / widthFitHeight) * 100)))
}

/** 쪽 높이를 창 높이에 맞춘 배율(폭 맞춤 = 100). 가로로 긴 쪽이면 100 을 넘어 옆으로 넘친다 */
export function pageHeightFitZoom(pageSize: readonly [number, number], viewport: Measured): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 100
  const [pageWidth, pageHeight] = pageSize
  const widthFitHeight = (viewport.width * pageHeight) / pageWidth
  return Math.max(10, Math.round((viewport.height / widthFitHeight) * 100))
}

export function PdfPane({ docId, pageSizes, hasText, title = 'PDF', zoomPercent = 100, zoomScale = 0, onPageChange, pageRequest, onViewportChange, onZoomChange, onAnchorCreated, onPersistentHighlightCreated, onPersistentHighlightRemoved, persistentHighlights = [], highlightAnchor = null, sourceHighlights = [], searchMatches = [], activeSearchMatchId = null, interactionMode = 'text', highlightColor, onInteractionModeChange, onHighlightColorChange, onSendToCanvas, onCopyWithSource, onSearchDocuments, onTranslateSelection, onSendTranslatedSelection, onLinkNavigate, onExternalLink, onPersistentHighlightUpdated, onPersistentHighlightsPatched, flashHighlightId = null, viewKey, onMovePin, overlays = [], onOverlayAdd, onOverlayUpdate, onOverlayRemove, searchJumpNonce = 0, spread = 'single', continuous = true, tone = 'none', rotation = 0, invert = false, onMemoJump, docTitles, primary = true, inSplit = false, pins = [], onAddPin, onUpdatePin, onRemovePin }: PdfPaneProps) {
  useEffect(() => {
    // OCR 엔진(수십 MB)은 스캔 쪽을 열었고 OCR 이 켜져 있을 때만, 화면이 한가할 때 미리 띄운다.
    // 꺼 두면 영역을 처음 잡을 때 그제야 띄운다.
    if (hasText || !getAppPrefs().ocr) return
    const warm = () => { void prewarmPdfTextDetector() }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(warm, 1500)
    return () => window.clearTimeout(handle)
  }, [docId, hasText])
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState<Measured>({ width: 0, height: 0 })
  /** PDF 창 틀 전체(오른쪽 메모 바 포함)의 폭. 메모 바 폭을 정할 때 쓴다 */
  const [frameWidth, setFrameWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  // 큰 확대에서 보이는 타일만 받으려면 가로 위치도 안다
  const [scrollLeft, setScrollLeft] = useState(0)
  // 메모 바는 PDF 와 따로 스크롤한다. 선은 두 스크롤 위치로 매번 다시 잇는다
  const memoBarScrollRef = useRef<HTMLDivElement | null>(null)
  // 메모 바 맨 위 서식 도구의 아래 끝(바 위에서부터 px)
  const [dockBottom, setDockBottom] = useState(0)
  const [memoBarScroll, setMemoBarScroll] = useState({ top: 0, height: 0 })
  const [memoCardLayout, setMemoCardLayout] = useState<ReadonlyMap<string, { top: number; height: number }>>(new Map())
  // PDF 창 위쪽 안쪽 여백. 페이지는 그만큼 내려와 있으니 메모 바 안쪽도 같이 내린다(선이 경계에서 어긋나지 않게)
  const paneInsetTopRef = useRef(0)
  const [paneInsetTop, setPaneInsetTop] = useState(0)
  const pendingLeftRef = useRef(0)
  const [pageIndexes, setPageIndexes] = useState<ReadonlyMap<number, PageTextIndex>>(new Map())
  const [anchors, setAnchors] = useState<ReadonlyMap<number, Anchor>>(new Map())
  const [pageLinks, setPageLinks] = useState<ReadonlyMap<number, readonly PdfLink[]>>(new Map())
  const [openHighlight, setOpenHighlight] = useState<{ id: string; point: { x: number; y: number } } | null>(null)
  // 형광펜 색·지우개는 도구줄의 형광펜 색 판과 같이 쓴다
  const [highlightTool, setHighlightTool] = useHighlightTool()
  const eraseHighlights = highlightTool.erase
  const selectedHighlightColor = highlightColor ?? highlightTool.color
  // 왼쪽 끌기로 고르면 생기는 새 메모(글을 써야 저장된다). 그동안 형광펜처럼 칠해 보인다
  const [draftMemo, setDraftMemo] = useState<PersistentPdfHighlight | null>(null)
  // 박스 메모(PDF 쪽 위에 떠 있는 메모): 아직 저장 전인 새 박스, 글을 고치는 중인 박스
  // PDF 위 편집: 지금 도구·색·크기(이 창에서만 기억)
  const [overlayTool, setOverlayTool] = useOverlayTool()
  // 새로 만들 것의 서식: 도구마다 따로 기억(PDF·Markdown 같이)
  const [overlayStyle, patchOverlayStyle] = useToolStyle(overlayTool)
  // PDF 편집에서 고른 덮개(서식은 위 도구창에서 바꾼다)
  const [overlaySelectedId, setOverlaySelectedId] = useState<string | null>(null)
  useEffect(() => { if (interactionMode !== 'edit') setOverlaySelectedId(null) }, [interactionMode])
  // 박스 메모 서식 단추를 놓을 자리(위 도구창 안)
  const [boxFormatSlot, setBoxFormatSlot] = useState<HTMLDivElement | null>(null)
  const [draftBox, setDraftBox] = useState<PersistentPdfHighlight | null>(null)
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null)
  const persistentHighlightsByPage = useMemo(() => {
    const grouped = new Map<number, PersistentPdfHighlight[]>()
    for (const highlight of [...persistentHighlights, ...(draftMemo === null ? [] : [draftMemo]), ...(draftBox === null ? [] : [draftBox])]) {
      if (highlight.anchor.docId !== docId) continue
      const pageHighlights = grouped.get(highlight.anchor.page) ?? []
      pageHighlights.push(highlight)
      grouped.set(highlight.anchor.page, pageHighlights)
    }
    return grouped
  }, [docId, draftBox, draftMemo, persistentHighlights])
  const highlightsByPage = useMemo(() => {
    const grouped = new Map<number, { blockId: string; anchor: Anchor }[]>()
    for (const source of sourceHighlights) {
      if (source.anchor.docId !== docId) continue
      const pageHighlights = grouped.get(source.anchor.page) ?? []
      pageHighlights.push({ blockId: source.blockId, anchor: source.anchor })
      grouped.set(source.anchor.page, pageHighlights)
    }
    return grouped
  }, [docId, sourceHighlights])
  const searchHighlightsByPage = useMemo(() => {
    const grouped = new Map<number, { id: string; rects: Anchor['rects']; active: boolean }[]>()
    for (const match of searchMatches) {
      if (match.docId !== docId) continue
      const pageMatches = grouped.get(match.page) ?? []
      pageMatches.push({ id: match.id, rects: match.rects, active: match.id === activeSearchMatchId })
      grouped.set(match.page, pageMatches)
    }
    return grouped
  }, [activeSearchMatchId, docId, searchMatches])

  // 스크롤 이벤트를 프레임 단위로 합친다. 던지듯 스크롤하면 이벤트가
  // 프레임보다 자주 오고, 그때마다 상태를 바꾸면 중간에 스쳐 지나간
  // 페이지까지 요청이 걸린다. Rust 의 렌더 큐는 FIFO 에 취소가 없어서,
  // 이미 화면 밖으로 나간 페이지가 워커를 큐 대기 시간만큼 붙잡는다 —
  // 그동안 지금 보이는 페이지가 뒤에서 기다린다. 요청을 만드는 쪽에서
  // 줄이는 것이 유일하게 효과가 있는 자리다.
  const pendingScrollRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const scrollDragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null)

  useEffect(() => {
    return () => {
      const frame = frameRef.current
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (interactionMode !== 'highlight') setHighlightTool({ erase: false })
  }, [interactionMode])


  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop
    pendingScrollRef.current = next
    pendingLeftRef.current = event.currentTarget.scrollLeft

    // rAF 가 없는 환경(일부 테스트 런너)에서는 합치지 않고 바로 반영한다.
    // 합치기는 성능을 위한 것이지 정확성을 위한 것이 아니므로 없어도 된다.
    if (typeof requestAnimationFrame !== 'function') {
      setScrollTop(next)
      setScrollLeft(pendingLeftRef.current)
      return
    }

    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingScrollRef.current
      if (pending !== null) setScrollTop(pending)
      setScrollLeft(pendingLeftRef.current)
    })
  }

  // 상자 크기는 레이아웃 뒤에 읽어야 한다. useEffect 면 한 프레임 동안
  // 0 으로 그렸다가 고쳐 그리는 것이 눈에 보인다.
  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (element === null) return

    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      onViewportChange?.({ width, height })
      // 같은 값이면 상태를 그대로 돌려줘 React 가 다시 그리지 않게 한다.
      // 구분선을 끄는 동안 ResizeObserver 가 프레임마다 불리는데, 여기서
      // 거르지 않으면 폭이 안 바뀌는 세로 드래그에도 전체가 다시 그려진다.
      setMeasured((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
      setFrameWidth(element.closest<HTMLElement>('.pane-frame')?.clientWidth ?? 0)
    }

    measure()

    // jsdom 에는 ResizeObserver 가 없다. 최초 측정만으로도 테스트는 성립하므로
    // 없으면 조용히 지나간다 — 여기서 던지면 테스트가 화면을 못 그린다.
    if (typeof ResizeObserver === 'undefined') return

    const scheduler = createFrameScheduler(measure)
    // 패널 구분선을 끄는 동안은 폭 맞춤(쪽 전체 다시 배치·다시 그리기)을 드물게만 한다. 놓으면 바로 맞춘다
    let throttle: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (!document.body.classList.contains('pane-resizing')) {
        scheduler.schedule()
        return
      }
      if (throttle !== null) return
      throttle = setTimeout(() => {
        throttle = null
        scheduler.schedule()
      }, RESIZE_THROTTLE_MS)
    }
    const onResizeEnd = () => {
      if (throttle !== null) clearTimeout(throttle)
      throttle = null
      scheduler.schedule()
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(element)
    const frame = element.closest<HTMLElement>('.pane-frame')
    if (frame !== null) observer.observe(frame)
    window.addEventListener('iwae:pane-resize-end', onResizeEnd)
    return () => {
      observer.disconnect()
      scheduler.cancel()
      if (throttle !== null) clearTimeout(throttle)
      window.removeEventListener('iwae:pane-resize-end', onResizeEnd)
    }
  }, [onViewportChange])

  // 100% 는 작업영역에 맞춘 폭이다. 양쪽 12px 는 페이지 그림자와 회색
  // 작업영역이 실제로 보이는 최소 여백이고, 확대하면 자연스럽게 사라진다.
  // 메모 카드 열(형광펜 메모를 페이지 오른쪽에 붙인다). 돌리지 않은 상태에서, 형광펜이 있을 때만 자리를 낸다
  // 펼침/접기는 맨 위 줄의 메모 바 단추가 정한다(모든 PDF 창이 같이 따른다)
  const memoColumnVisible = useMemoBarVisible()
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null)
  const [activeMemoId, setActiveMemoId] = useState<string | null>(null)
  /** 노트 바 맨 위의 서식 도구 자리(쓰는 칸의 서식 단추가 이리로 온다) */
  const [formatSlot, setFormatSlot] = useState<HTMLDivElement | null>(null)
  /** 노트에서 원문을 펼쳐 둔 형광펜(나머지는 한 줄 출처 칩으로 접혀 있다). 화면에서만 기억한다 */
  const [openQuotes, setOpenQuotes] = useState<ReadonlySet<string>>(() => new Set())
  const toggleQuote = (id: string, collapsed: boolean) => setOpenQuotes((current) => {
    const next = new Set(current)
    if (collapsed) next.delete(id)
    else next.add(id)
    return next
  })
  const memoAvailable = rotation === 0 && onPersistentHighlightUpdated !== undefined
  const [memoOnly, setMemoOnly] = useState(false)
  const [memoQuery, setMemoQuery] = useState('')
  const [localFlashId, setLocalFlashId] = useState<string | null>(null)
  // 오른쪽 바는 열린 「노트」를 보인다(PDF 와 따로 열리고, 여러 PDF 의 메모와 글 블록을 담는다).
  // 노트 기능이 없는 곳(일부 시험)에서는 이 PDF 의 메모를 문서 순서로 보인다
  const noteApi = useMemoNoteApi()
  const highlightById = useMemo(() => new Map(persistentHighlights.map((highlight) => [highlight.id, highlight])), [persistentHighlights])
  // (노트 기능 없음) 메모가 아직 없는 형광펜도 누르면 카드로 보인다
  const [fallbackShownId, setFallbackShownId] = useState<string | null>(null)
  const fallbackBlocks = useMemo<readonly MemoNoteBlock[]>(() => noteApi !== null ? [] : persistentHighlights
    .filter((highlight) => highlight.anchor.docId === docId && ((highlight.note ?? '').trim() !== '' || highlight.id === fallbackShownId))
    .sort((a, b) => a.anchor.page - b.anchor.page || Math.min(...a.anchor.rects.map((rect) => rect.y)) - Math.min(...b.anchor.rects.map((rect) => rect.y)))
    .map((highlight) => ({ id: highlight.id, kind: 'memo' as const, highlightId: highlight.id })), [docId, fallbackShownId, noteApi, persistentHighlights])
  const noteBlocks: readonly MemoNoteBlock[] = noteApi === null ? fallbackBlocks : noteApi.openNote?.blocks ?? []
  const updateNote = (change: (note: MemoNote) => MemoNote) => noteApi?.updateOpen(change)
  // 새 메모가 들어갈 노트 안 자리(만들 때 보고 있던 화면 가운데)
  const [draftIndex, setDraftIndex] = useState(0)
  const noteItems: NoteFlowItem[] = []
  // 접힌 소제목 아래 블록은 숨긴다(새로 쓰는 메모는 늘 보인다)
  let hidden = false
  noteBlocks.forEach((block, index) => {
    if (draftMemo !== null && index === draftIndex) noteItems.push({ kind: 'memo', key: 'draft', highlight: draftMemo, draft: true })
    if (block.kind === 'section') {
      hidden = block.collapsed === true
      const next = noteBlocks.findIndex((item, at) => at > index && item.kind === 'section')
      noteItems.push({ kind: 'section', key: block.id, title: block.title, collapsed: hidden, count: (next < 0 ? noteBlocks.length : next) - index - 1 })
      return
    }
    if (hidden) return
    if (block.kind === 'text') {
      noteItems.push({ kind: 'text', key: block.id, text: block.text, ...(block.html === undefined ? {} : { html: block.html }) })
      return
    }
    const highlight = highlightById.get(block.highlightId)
    if (highlight === undefined) return
    noteItems.push({
      kind: 'memo',
      key: block.id,
      highlight,
      // 다른 PDF 의 메모: 그 PDF 이름(「·」 앞의 짧은 이름)을 카드 머리에
      ...(highlight.anchor.docId === docId ? {} : { docLabel: (docTitles?.[highlight.anchor.docId] ?? t('다른 PDF')).split(' · ')[0]! }),
      sourceLabel: docTitles?.[highlight.anchor.docId] ?? (highlight.anchor.docId === docId ? title : t('다른 PDF')),
      ...(block.ticket === undefined ? {} : { ticket: block.ticket }),
      ...((block.refs ?? []).length === 0 ? {} : { extraHighlights: (block.refs ?? []).flatMap((ref) => { const found = highlightById.get(ref); return found === undefined ? [] : [found] }) }),
    })
  })
  if (draftMemo !== null && draftIndex >= noteBlocks.length) noteItems.push({ kind: 'memo', key: 'draft', highlight: draftMemo, draft: true })
  const noteMemos = noteItems.flatMap((item) => item.kind === 'memo' && item.draft !== true ? [item.highlight] : [])
  // 창을 여러 칸으로 나눴으면 노트 바는 맨 오른쪽 위 칸에만
  const noteHost = useIsNoteHostPane(scrollerRef)
  const memoColumn = primary && noteHost && memoAvailable && memoColumnVisible && !memoOnly
  // 다른 칸을 고르면 이 칸은 메모 바를 내려놓는다(메모만 보기도 끝낸다)
  useEffect(() => {
    if (!primary) setMemoOnly(false)
  }, [primary])
  // 좁은 창에서는 메모 열도 좁힌다(창의 30%, 180–300px)
  // 메모는 PDF 오른쪽의 따로 떨어진 바에 둔다. PDF 창(스크롤 상자)은 그 왼쪽만 쓴다
  // 메모 바 폭: Markdown 과 같은 값(src/pdf/memoBarWidth). 전체 폭은 창 틀을 직접 잰다 — 「PDF 폭 + 바 폭」으로 셈하면
  // 끌어 넓힌 바가 창에 다 안 들어갈 때 바를 줄이면 PDF 가 넓어지고, 다시 바를 넓히는 것을 프레임마다 되풀이해 화면이 떨렸다
  const paneTotalWidth = frameWidth > 0 ? frameWidth : measured.width + (memoColumn ? MEMO_BAR_WIDTH : 0)
  const memoBar = useMemoBarWidth(paneTotalWidth, memoColumn && measured.width > 0)
  const memoBarSize = memoBar.size
  const memoBarWidth = memoColumn ? memoBarSize : 0

  // 메모 바는 PDF 창 틀 전체(위 제목줄 ~ 아래 하단바)를 차지한다. PDF 의 제목·도구·하단바는 그 왼쪽만 쓴다
  const [paneFrame, setPaneFrame] = useState<HTMLElement | null>(null)
  const [barBodyTop, setBarBodyTop] = useState(0)
  // 화면 나누기: 이 칸이 칸 상자 안에서 얼마나 아래에 있는가, 메모 바에 붙은 오른쪽 칸인가
  const [cellPlace, setCellPlace] = useState({ top: 0, atRight: true })
  useLayoutEffect(() => {
    const element = scrollerRef.current
    const frame = element?.closest<HTMLElement>('.pane-frame') ?? null
    if (frame !== paneFrame) setPaneFrame(frame)
    if (element === null || frame === null) return
    // 메모 바 몸통은 PDF 칸들 전체의 맨 위에 맞춘다(나누지 않았으면 이 스크롤 상자)
    const split = inSplit ? element.closest<HTMLElement>('.pdf-split') : null
    const box = element.getBoundingClientRect()
    const area = split?.getBoundingClientRect() ?? box
    const top = Math.round(area.top - frame.getBoundingClientRect().top)
    if (top !== barBodyTop) setBarBodyTop(top)
    const place = { top: Math.round(box.top - area.top), atRight: area.right - box.right < 2 }
    if (place.top !== cellPlace.top || place.atRight !== cellPlace.atRight) setCellPlace(place)
  })
  useLayoutEffect(() => {
    if (!primary) return
    const paneDoc = scrollerRef.current?.closest<HTMLElement>('.pane-doc')
    if (paneDoc === null || paneDoc === undefined) return
    paneDoc.style.setProperty('--memo-bar-w', `${memoBarWidth}px`)
    return () => {
      paneDoc.style.removeProperty('--memo-bar-w')
    }
  }, [memoBarWidth, primary])
  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (element === null || typeof getComputedStyle !== 'function') return
    const inset = Number.parseFloat(getComputedStyle(element).paddingTop) || 0
    paneInsetTopRef.current = inset
    if (inset !== paneInsetTop) setPaneInsetTop(inset)
  }, [measured.width, measured.height, paneInsetTop])
  const fittedWidth = Math.max(measured.width - PAGE_GUTTER * 2, 0)
  const contentWidth = Math.max((fittedWidth * zoomPercent) / 100, 0)
  // 페이지(와 메모 열)를 가운데에 놓았을 때 페이지 왼쪽 끝
  const contentLeft = Math.max((measured.width - contentWidth) / 2, 0)

  // 90·270도 돌리면 배치에 쓰는 페이지 크기는 가로세로가 바뀐 것이다.
  const quarterTurned = rotation === 90 || rotation === 270
  const layoutSizes = useMemo(
    () => quarterTurned ? pageSizes.map(([width, height]) => [height, width] as const) : pageSizes,
    [pageSizes, quarterTurned],
  )
  const rawBoxes = useMemo<SpreadBox[]>(
    () => spread !== 'single'
      ? layoutSpread(layoutSizes, contentWidth, PAGE_GAP, spreadColumns(spread))
      : layoutPages(layoutSizes, contentWidth, PAGE_GAP).map((box) => ({ ...box, left: 0, width: contentWidth })),
    [contentWidth, layoutSizes, spread],
  )
  // 넘겨 보기: 지금 화면(한 쪽 또는 한 쌍)만 문서 맨 위에 놓고 나머지는 그리지 않는다
  const paged = !continuous
  const [pagedIndex, setPagedIndex] = useState(() => Math.max((pageRequest?.page ?? 1) - 1, 0))
  const unit = paged ? pageUnitAt(rawBoxes, pagedIndex) : null
  const unitTop = unit?.top ?? 0
  const boxes = useMemo(
    () => rawBoxes.map((box) => ({ ...box, top: box.top - unitTop + PAGE_GUTTER })),
    [rawBoxes, unitTop],
  )
  const continuousHeight = useMemo(
    () => (spread !== 'single' ? spreadHeight(rawBoxes) : totalHeight(rawBoxes, PAGE_GAP)) + PAGE_GUTTER,
    [rawBoxes, spread],
  )
  const docHeight = unit === null ? continuousHeight : unit.height + PAGE_GUTTER * 2
  // 넘긴 뒤 새 화면에서 어디를 보일까(위·아래 끝 또는 그 좌표)
  const pagedScrollRef = useRef<'top' | 'bottom' | number | null>(null)
  const goPaged = (index: number, where: 'top' | 'bottom' | number) => {
    pagedScrollRef.current = where
    setPagedIndex(Math.min(Math.max(index, 0), Math.max(pageSizes.length - 1, 0)))
  }

  // 배율은 렌더 중에 읽는다. 창을 배율이 다른 모니터로 옮기면 값이 바뀌지만
  // 그 순간 ResizeObserver 도 거의 항상 함께 불리므로 따로 구독하지 않는다.
  const ratio =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1
  const renderWidth = renderWidthFor(contentWidth, ratio)

  const memoTargets: (MemoTarget & { readonly key: string })[] = !memoColumn ? [] : noteItems.flatMap((item) => {
    if (item.kind !== 'memo') return []
    // 한 메모의 원문이 여럿이면 원문마다 선을 잇는다
    return [item.highlight, ...(item.extraHighlights ?? [])].filter((highlight) => highlight.anchor.docId === docId)
      .flatMap((highlight) => memoTargetOf(item.key, highlight, item.draft === true))
  })
  function memoTargetOf(key: string, highlight: PersistentPdfHighlight, draft: boolean): (MemoTarget & { readonly key: string })[] {
    const page = highlight.anchor.page
    const box = boxes[page]
    const pageSize = pageSizes[page]
    const rects = highlight.anchor.rects
    if (box === undefined || pageSize === undefined || pageSize[0] <= 0 || rects.length === 0) return []
    const scale = box.width / pageSize[0]
    const firstTop = Math.min(...rects.map((rect) => rect.y))
    const firstLine = rects.filter((rect) => rect.y < firstTop + 2)
    const lineRight = Math.max(...firstLine.map((rect) => rect.x + rect.w))
    return [{
      key,
      highlight,
      draft,
      top: box.top + firstTop * scale,
      // 표·그림 네모는 대상 바깥 4px 에 그린다(SelectionLayer REGION_OUTSET) — 선은 오른쪽 위 꺾쇠에서 나온다
      anchorX: contentLeft + box.left + lineRight * scale + (highlight.kind === 'region' ? 4 : 0),
      // 글: 첫 줄 위 가장자리(오른쪽 위 모서리)에서 나온다. 줄 가운데서 나오면 같은 줄 뒷글자를 가로질러 취소선처럼 보인다
      anchorY: highlight.kind === 'region' ? box.top + firstTop * scale + 8 : box.top + firstTop * scale - 1.5,
    }]
  }

  // 메모 바의 보이는 높이(창 크기가 바뀌면 다시 잰다)
  useLayoutEffect(() => {
    const element = memoBarScrollRef.current
    if (element === null) return
    if (element.clientHeight !== memoBarScroll.height || element.scrollTop !== memoBarScroll.top) {
      setMemoBarScroll({ top: element.scrollTop, height: element.clientHeight })
    }
    // 노트 목록은 맨 위 서식 도구 아래에서 시작한다. 선은 그 아래에만 그린다
    const bottom = element.offsetTop
    if (bottom !== dockBottom) setDockBottom(bottom)
  })
  // 쓰기 시작한 카드(새 메모·PDF 에서 누른 형광펜)는 메모 바에서 보이게 굴린다
  const focusMemoId = draftMemo !== null ? 'draft' : editingMemoId
  useEffect(() => {
    if (focusMemoId === null) return
    const card = memoBarScrollRef.current?.querySelector<HTMLElement>(`[data-note-block="${focusMemoId}"]`)
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [focusMemoId])
  // 문서를 처음 보일 때와 쪽 이동(쪽 칸·목차·링크)을 한 뒤에는 메모 바도 그 쪽의 메모부터 보인다.
  // 그냥 굴리는 동안은 따로 스크롤한다
  const memoBarStartedRef = useRef(false)
  useEffect(() => {
    memoBarStartedRef.current = false
  }, [pageRequest])
  useEffect(() => {
    if (memoBarStartedRef.current || memoCardLayout.size === 0) return
    // PDF 가 요청받은 쪽으로 옮겨 간 뒤에 맞춘다
    if (pageRequest !== undefined && handledPageRequestRef.current !== pageRequest) return
    memoBarStartedRef.current = true
    const startPage = Math.max(boxes.findIndex((pageBox) => pageBox.top + pageBox.height > scrollTop), 0)
    const first = memoTargets.filter((target) => target.highlight.anchor.page >= startPage).sort((a, b) => a.highlight.anchor.page - b.highlight.anchor.page || a.top - b.top)[0]
    const box = first === undefined ? undefined : memoCardLayout.get(first.key)
    if (box !== undefined && memoBarScrollRef.current !== null) memoBarScrollRef.current.scrollTop = Math.max(box.top - 12, 0)
  })

  // 메모 바를 접으면 쓰던 새 메모·고치기를 그만둔다
  useEffect(() => {
    if (memoColumnVisible) return
    setDraftMemo(null)
    setEditingMemoId(null)
  }, [memoColumnVisible])

  // 형광펜(PDF 화면) → 카드(메모 바 화면) 선: 둘 다 보일 때만. 바 쪽 곡선과 페이지 안쪽 점선이 같은 목록을 쓴다
  const memoLinkLines = !memoColumn || !cellPlace.atRight ? [] : memoTargets.flatMap((target) => {
    const box = memoCardLayout.get(target.key)
    if (box === undefined) return []
    if (unit !== null && (target.highlight.anchor.page < unit.first || target.highlight.anchor.page > unit.last)) return []
    const inCellY = target.anchorY - scrollTop + paneInsetTop
    const anchorY = inCellY + cellPlace.top
    const cardY = box.top - memoBarScroll.top + 18 + dockBottom
    if (inCellY < 0 || inCellY > measured.height || cardY < dockBottom || cardY > dockBottom + memoBarScroll.height) return []
    const active = target.key === activeMemoId || target.key === editingMemoId || target.draft === true
    return [{ target, anchorY, cardY, active }]
  }).sort((a, b) => Number(a.active) - Number(b.active))
  const linkedKeys = new Set(memoLinkLines.map((line) => line.target.key))

  /** 이 PDF 안의 메모로 옮기고 그 형광펜을 잠깐 깜빡인다. 다른 PDF 면 App 에 맡긴다 */
  const jumpToMemo = (highlight: PersistentPdfHighlight) => {
    if (highlight.anchor.docId !== docId) {
      onMemoJump?.(highlight)
      return
    }
    const page = highlight.anchor.page
    const box = boxes[page]
    const pageSize = pageSizes[page]
    const element = scrollerRef.current
    if (box !== undefined && pageSize !== undefined && element !== null) {
      const rectTop = Math.min(...highlight.anchor.rects.map((rect) => rect.y)) * (box.width / pageSize[0])
      if (unit !== null && (page < unit.first || page > unit.last)) {
        // 넘겨 보기: 그 쪽으로 넘긴 뒤 메모 자리로(새 화면에서 그 쪽은 맨 위에 놓인다)
        goPaged(page, Math.max(PAGE_GUTTER + rectTop - measured.height / 3, 0))
      } else {
        element.scrollTo({ top: Math.max(box.top + rectTop - measured.height / 3, 0), behavior: 'smooth' })
      }
    }
    setActiveMemoId(highlight.id)
    setLocalFlashId(highlight.id)
    window.setTimeout(() => setLocalFlashId((current) => current === highlight.id ? null : current), 1400)
  }

  /**
   * 고른 것(글은 끌기, 표·그림은 Ctrl+끌기나 영역 선택 도구)에 새 메모 카드를 연다.
   * 글 메모는 글을 써야 저장되고, 표·그림은 글 없이도 남는다
   */
  const startDraftMemo = (selection: PdfExcerptSelection) => {
    // 메모에 원문을 더하는 중이면 고른 것을 그 메모의 원문으로
    if (attachKey !== null && interactionMode !== 'box') {
      attachSelection(selection, attachKey)
      return
    }
    // 박스 메모 모드: 글을 끌면 PDF 안에 선으로 이어진 박스가 생긴다(메모 바·노트로 가지 않는다)
    if (interactionMode === 'box') {
      startDraftBox(selection)
      return
    }
    const region = selection.mode === 'region'
    if (!memoAvailable || !memoColumnVisible || memoOnly) return
    // 손 도구는 글을 골라 복사만 한다(메모 바로 보내지 않는다)
    if (interactionMode !== 'text' && !(interactionMode === 'lasso' && region)) return
    if (!region && selection.anchor.quote.trim() === '') return
    const pageSize = pageSizes[selection.anchor.page]
    const highlight = createPersistentPdfHighlight(selection.anchor, selectedHighlightColor, {
      kind: region ? 'region' : undefined,
      pageSize: region ? pageSize : undefined,
      createdAt: new Date().toISOString(),
      source: 'iwae',
    })
    // 이미 칠한 곳과 겹치면 새로 칠하지 않는다(형광펜 안에 또 형광펜 금지) — 그 메모를 연다
    const rectsOverlap = (left: readonly { x: number; y: number; w: number; h: number }[], right: readonly { x: number; y: number; w: number; h: number }[]) =>
      left.some((a) => right.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h))
    const existing = persistentHighlights.find(({ id }) => id === highlight.id)
      ?? persistentHighlights.find((item) => item.anchor.docId === docId && item.anchor.page === selection.anchor.page && (
        !region && item.kind !== 'region'
          ? item.anchor.charRange[0] < selection.anchor.charRange[1] && selection.anchor.charRange[0] < item.anchor.charRange[1]
          : rectsOverlap(item.anchor.rects, selection.anchor.rects)))
    if (existing !== undefined) {
      setDraftMemo(null)
      clearPageSelection(selection.anchor.page)
      showHighlightInNote(existing.id)
      return
    }
    // 노트가 하나도 열려 있지 않으면 새로 만들어 연다. 사용자가 「노트 닫기」로 닫아 두었으면 만들지 않는다(고른 것만 남긴다)
    if (noteApi !== null && noteApi.openPath === null) {
      if (noteApi.closed === true) return
      void noteApi.create()
    }
    setEditingMemoId(null)
    setDraftIndex(noteCenterIndex())
    // 같은 자리를 다시 받으면(스캔 영역의 OCR 글자가 뒤늦게 온 경우) 원문 글만 바꿔 끼운다
    setDraftMemo((current) => current?.id === highlight.id ? (current.anchor.quote === highlight.anchor.quote ? current : { ...current, anchor: { ...current.anchor, quote: highlight.anchor.quote } }) : highlight)
  }

  /** 박스 메모 모드에서 고른 글: 이미 박스가 있으면 그 박스를 열고, 아니면 여백에 새 박스(글을 써야 저장된다) */
  const startDraftBox = (selection: PdfExcerptSelection) => {
    if (selection.mode === 'region' || selection.anchor.quote.trim() === '' || rotation !== 0) return
    const page = selection.anchor.page
    const pageSize = pageSizes[page]
    if (pageSize === undefined) return
    const overlapping = persistentHighlights.find((item) => item.anchor.docId === docId && item.anchor.page === page && item.kind !== 'region'
      && item.anchor.charRange[0] < selection.anchor.charRange[1] && selection.anchor.charRange[0] < item.anchor.charRange[1])
    if (overlapping !== undefined) {
      clearPageSelection(page)
      if (overlapping.box !== undefined) setEditingBoxId(overlapping.id)
      else announceAction(t('이미 메모를 단 글입니다. 박스 메모는 칠하지 않은 글에 만듭니다'))
      return
    }
    const textRects = (pageIndexes.get(page)?.chars ?? []).filter((char) => char.w > 0 && char.h > 0).map((char) => ({ x: char.x, y: char.y, w: char.w, h: char.h }))
    const box = placeBoxMemo(pageSize, selection.anchor.rects, textRects, BOX_DEFAULT_WIDTH)
    const created = createPersistentPdfHighlight(selection.anchor, selectedHighlightColor, { createdAt: new Date().toISOString(), source: 'iwae' })
    setDraftMemo(null)
    setDraftBox({ ...created, box })
    setEditingBoxId(created.id)
    clearPageSelection(page)
  }
  /** 박스 메모 저장: 새 박스는 글이 있어야 남는다. 지우는 글이면 박스도 함께 거둔다 */
  const saveBoxMemo = (id: string, content: MemoContent) => {
    if (draftBox !== null && id === draftBox.id) {
      const draft = draftBox
      setDraftBox(null)
      if (content.text.trim() === '') return
      onPersistentHighlightCreated?.(updatePersistentPdfHighlight(draft, { note: content.text, noteHtml: content.html }))
      return
    }
    onPersistentHighlightUpdated?.(id, { note: content.text, noteHtml: content.html })
  }

  /** 노트에서 지금 보고 있는 화면 가운데의 블록 자리(새 블록을 그 앞에 끼운다) */
  const noteCenterIndex = () => {
    const center = memoBarScroll.top + memoBarScroll.height / 2
    const index = noteBlocks.findIndex((block) => {
      const box = memoCardLayout.get(block.id)
      return box !== undefined && box.top + box.height / 2 > center
    })
    return index < 0 ? noteBlocks.length : index
  }
  /**
   * 이 형광펜의 메모를 노트에서 보이며 고치기로 연다: 열린 노트에 있으면 그 카드, 다른 노트에 있으면 그 노트를 열고,
   * 어느 노트에도 없으면 열린 노트의 지금 보는 자리에 넣는다
   */
  const pendingEditHighlightRef = useRef<string | null>(null)
  const showHighlightInNote = (highlightId: string) => {
    setMemoOnly(false)
    const inOpen = noteBlocks.find((block) => block.kind === 'memo' && block.highlightId === highlightId)
    if (inOpen !== undefined) {
      // 접힌 소제목 안이면 펼친다
      const section = noteBlocks.slice(0, noteBlocks.indexOf(inOpen)).reverse().find((block) => block.kind === 'section')
      if (section?.kind === 'section' && section.collapsed === true) updateNote((note) => updateSection(note, section.id, { collapsed: false }))
      setEditingMemoId(inOpen.id)
      return
    }
    if (noteApi === null) {
      setFallbackShownId(highlightId)
      setEditingMemoId(highlightId)
      return
    }
    const other = noteApi.notesOf(highlightId)[0]
    if (other !== undefined) {
      pendingEditHighlightRef.current = highlightId
      noteApi.open(other)
      return
    }
    if (noteApi.openPath === null) {
      pendingEditHighlightRef.current = highlightId
      void noteApi.create()
      return
    }
    const block = memoBlock(highlightId)
    updateNote((note) => insertBlock(note, block, noteCenterIndex()))
    setEditingMemoId(block.id)
  }
  // 다른 노트를 연 뒤(또는 새 노트를 만든 뒤) 그 형광펜의 카드를 고치기로
  useEffect(() => {
    const highlightId = pendingEditHighlightRef.current
    if (highlightId === null || noteApi?.openNote == null) return
    pendingEditHighlightRef.current = null
    const block = noteApi.openNote.blocks.find((item) => item.kind === 'memo' && item.highlightId === highlightId)
    if (block !== undefined) {
      setEditingMemoId(block.id)
      return
    }
    const added = memoBlock(highlightId)
    noteApi.updateOpen((note) => insertBlock(note, added, note.blocks.length))
    setEditingMemoId(added.id)
  }, [noteApi])

  // 메모로 바꾼(또는 그만둔) 선택은 지운다. SelectionLayer 가 이 값이 바뀌면 고른 것과 작업 메뉴를 내린다
  const [selectionResetKey, setSelectionResetKey] = useState(0)
  const clearPageSelection = (page: number) => {
    setSelectionResetKey((key) => key + 1)
    setAnchors((previous) => {
      if (!previous.has(page)) return previous
      const next = new Map(previous)
      next.delete(page)
      return next
    })
    onAnchorCreated?.(null)
  }

  const saveMemo = (id: string, content: MemoContent, ticket?: MemoTicket) => {
    const patch = { note: content.text, noteHtml: content.html }
    if (draftMemo !== null && id === draftMemo.id) {
      const draft = draftMemo
      setDraftMemo(null)
      clearPageSelection(draft.anchor.page)
      // 아무것도 안 썼으면 칠한 것도 함께 사라진다. 표·그림은 그 자체가 내용이라 글 없이도 남긴다
      if (content.text.trim() === '' && draft.kind !== 'region') return
      onPersistentHighlightCreated?.(updatePersistentPdfHighlight(draft, patch))
      const at = draftIndex
      updateNote((note) => insertBlock(note, memoBlock(draft.id, ticket), at))
      return
    }
    onPersistentHighlightUpdated?.(id, patch)
  }

  /** 원문을 더하는 중인 메모 블록(다음에 PDF 에서 고른 글이 그 블록의 원문이 된다) */
  const [attachKey, setAttachKey] = useState<string | null>(null)
  useEffect(() => {
    if (attachKey === null) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setAttachKey(null) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [attachKey])
  /** 고른 것을 attachKey 블록의 원문으로 단다. 이미 칠한 곳이면 그 형광펜을 단다 */
  const attachSelection = (selection: PdfExcerptSelection, blockKey: string) => {
    const region = selection.mode === 'region'
    if (!region && selection.anchor.quote.trim() === '') return
    const highlight = createPersistentPdfHighlight(selection.anchor, selectedHighlightColor, {
      kind: region ? 'region' : undefined,
      pageSize: region ? pageSizes[selection.anchor.page] : undefined,
      createdAt: new Date().toISOString(),
      source: 'iwae',
    })
    const existing = persistentHighlights.find((item) => item.id === highlight.id)
    if (existing === undefined) onPersistentHighlightCreated?.(highlight)
    updateNote((note) => addMemoRef(note, blockKey, existing?.id ?? highlight.id))
    setAttachKey(null)
    clearPageSelection(selection.anchor.page)
    announceAction(t('메모에 원문을 더했습니다'))
  }
  /** 노트에서 고른 블록들을 한꺼번에 지운다: 메모는 형광펜과 함께, 글·소제목은 블록만 */
  const deleteNoteBlocks = (keys: readonly string[]) => {
    const wanted = new Set(keys)
    const blocks = noteBlocks.filter((block) => wanted.has(block.id))
    setEditingMemoId(null)
    for (const block of blocks) {
      if (block.kind === 'memo') {
        for (const id of memoHighlightIds(block)) onPersistentHighlightRemoved?.(id)
      }
    }
    updateNote((note) => ({ ...note, blocks: note.blocks.filter((block) => !wanted.has(block.id)) }))
    announceAction(t('{count}개 블록을 지웠습니다', { count: blocks.length }))
  }
  /** 노트의 글 블록: 비우고 저장하면 블록도 뺀다 */
  const saveTextBlock = (key: string, content: MemoContent) => {
    updateNote((note) => content.text.trim() === '' ? removeBlock(note, key) : updateTextBlock(note, key, content.text, content.html))
  }
  /** 블록 우클릭: key 블록 위에 소제목(이름부터 쓴다), 아래에 글 블록 */
  const insertNearBlock = (key: string, block: MemoNoteBlock, after: boolean) => {
    if (noteApi === null || noteApi.openPath === null) return
    setDraftMemo(null)
    updateNote((note) => {
      const at = note.blocks.findIndex((item) => item.id === key)
      return insertBlock(note, block, at < 0 ? note.blocks.length : at + (after ? 1 : 0))
    })
    setEditingMemoId(block.id)
  }
  /** 노트 맨 끝에 글 블록을 넣고 바로 쓴다. 끝 블록이 이미 빈 글이면 그것을 고친다 */
  const appendTextBlock = () => {
    if (noteApi === null || noteApi.openPath === null) return
    setDraftMemo(null)
    const last = noteApi.openNote?.blocks.at(-1)
    if (last?.kind === 'text' && last.text.trim() === '') {
      setEditingMemoId(last.id)
      return
    }
    const block = textBlock()
    updateNote((note) => insertBlock(note, block, note.blocks.length))
    setEditingMemoId(block.id)
  }
  /** 지금 보는 자리에 글 블록을 끼우고 바로 쓴다 */
  const addTextBlock = () => {
    if (noteApi === null || noteApi.openPath === null) return
    setDraftMemo(null)
    const block = textBlock()
    updateNote((note) => insertBlock(note, block, noteCenterIndex()))
    setEditingMemoId(block.id)
  }
  const cancelDraftMemo = () => {
    if (draftMemo !== null) clearPageSelection(draftMemo.anchor.page)
    setDraftMemo(null)
  }
  const patchMemo = (id: string, patch: PersistentPdfHighlightPatch) => {
    if (draftMemo !== null && id === draftMemo.id) setDraftMemo(updatePersistentPdfHighlight(draftMemo, patch))
    else onPersistentHighlightUpdated?.(id, patch)
  }

  // 노트 검색: 모든 PDF 의 메모에서 찾는다

  const [start, end] = unit !== null ? [unit.first, unit.last] : visibleRange(boxes, scrollTop, measured.height, OVERSCAN)
  const [visibleStart] = unit !== null ? [unit.first] : visibleRange(boxes, scrollTop, measured.height, 0)
  const visibleStartRef = useRef(visibleStart)
  visibleStartRef.current = visibleStart

  // 넘긴 화면이 그려지면 정해 둔 자리로 스크롤한다
  useLayoutEffect(() => {
    const where = pagedScrollRef.current
    const element = scrollerRef.current
    if (where === null || element === null) return
    pagedScrollRef.current = null
    const top = where === 'top' ? 0 : where === 'bottom' ? element.scrollHeight : where
    element.scrollTop = top
    setScrollTop(element.scrollTop)
  }, [pagedIndex])
  // 연속 ↔ 넘겨 보기를 바꿔도 보던 쪽을 그대로 둔다
  const pagedBeforeRef = useRef(paged)
  useLayoutEffect(() => {
    if (pagedBeforeRef.current === paged) return
    pagedBeforeRef.current = paged
    const element = scrollerRef.current
    if (paged) {
      goPaged(visibleStartRef.current, 'top')
      return
    }
    const box = boxes[pagedIndex]
    if (element === null || box === undefined) return
    element.scrollTop = Math.max(box.top - PAGE_GUTTER, 0)
    setScrollTop(element.scrollTop)
  }, [paged])

  useEffect(() => {
    if (boxes.length === 0 || end < start) return
    const pages: number[] = []
    for (let page = Math.max(0, start - PREVIEW_PREFETCH); page <= Math.min(boxes.length - 1, end + PREVIEW_PREFETCH); page++) pages.push(page)
    prefetchPreviews(docId, pages)
  }, [boxes.length, docId, end, start])

  // 검색 결과로 갈 때: 쪽 맨 위가 아니라 찾은 글자가 보이게 옮긴다(위아래·좌우 모두). 이미 보이면 그대로 둔다.
  // 예전에는 쪽 맨 위로만 가서, 쪽이 화면보다 길거나 확대했을 때 찾은 글자가 화면 밖에 남았다
  const searchJumpRef = useRef<string | null>(null)
  useEffect(() => {
    const jumpKey = `${activeSearchMatchId}:${searchJumpNonce}`
    if (!primary || activeSearchMatchId === null || searchJumpRef.current === jumpKey) return
    const match = searchMatches.find((candidate) => candidate.id === activeSearchMatchId && candidate.docId === docId)
    const element = scrollerRef.current
    if (match === undefined || element === null || contentWidth <= 0 || match.rects.length === 0) return
    if (unit !== null && (match.page < unit.first || match.page > unit.last)) {
      const size = pageSizes[match.page]
      const rawBox = rawBoxes[match.page]
      const top = size === undefined || rawBox === undefined ? 0 : Math.min(...match.rects.map((rect) => rect.y)) * (rawBox.width / size[0])
      searchJumpRef.current = jumpKey
      goPaged(match.page, Math.max(PAGE_GUTTER + top - measured.height / 3, 0))
      return
    }
    const box = boxes[match.page]
    const size = pageSizes[match.page]
    if (box === undefined || size === undefined) return
    searchJumpRef.current = jumpKey
    const scale = box.width / size[0]
    const top = box.top + Math.min(...match.rects.map((rect) => rect.y)) * scale
    const bottom = box.top + Math.max(...match.rects.map((rect) => rect.y + rect.h)) * scale
    const left = contentLeft + box.left + Math.min(...match.rects.map((rect) => rect.x)) * scale
    const right = contentLeft + box.left + Math.max(...match.rects.map((rect) => rect.x + rect.w)) * scale
    const margin = 24
    if (top < element.scrollTop + margin || bottom > element.scrollTop + element.clientHeight - margin) {
      element.scrollTop = Math.max(top - element.clientHeight / 3, 0)
    }
    if (left < element.scrollLeft + margin || right > element.scrollLeft + element.clientWidth - margin) {
      element.scrollLeft = Math.max(left - element.clientWidth / 3, 0)
    }
    setScrollTop(element.scrollTop)
    setScrollLeft(element.scrollLeft)
  }, [activeSearchMatchId, boxes, contentLeft, contentWidth, docId, pageSizes, primary, searchJumpNonce, searchMatches])

  // 쪽 이동 요청은 한 번만 처리한다. 예전에는 배치(boxes)가 바뀔 때마다 다시 돌아서, 확대·축소나
  // 패널 폭을 바꾸면 마지막으로 이동했던 쪽 맨 위로 튀었다.
  const handledPageRequestRef = useRef<{ page: number; nonce: number } | null>(null)
  useEffect(() => {
    if (pageRequest === undefined || handledPageRequestRef.current === pageRequest) return
    const box = boxes[pageRequest.page - 1]
    const element = scrollerRef.current
    // 아직 상자를 못 쟀으면(폭 0) 잰 뒤에 처리한다
    if (box === undefined || element === null || contentWidth <= 0) return
    const firstRequest = handledPageRequestRef.current === null
    handledPageRequestRef.current = pageRequest
    // 다른 탭에서 돌아왔다: 요청이 그때 그대로면 떠날 때의 자리(쪽 안의 높이까지)로 간다
    const saved = firstRequest && viewKey !== undefined ? savedPdfScrolls.get(viewKey) : undefined
    if (saved !== undefined && saved.request?.page === pageRequest.page && saved.request.nonce === pageRequest.nonce) {
      const savedBox = boxes[saved.page]
      if (savedBox !== undefined) {
        if (paged) {
          goPaged(saved.page, 'top')
          return
        }
        const top = Math.max(0, savedBox.top + saved.fractionY * savedBox.height)
        element.scrollTop = top
        element.scrollLeft = saved.scrollLeft
        setScrollTop(element.scrollTop)
        setScrollLeft(element.scrollLeft)
        return
      }
    }
    if (paged) {
      goPaged(pageRequest.page - 1, 'top')
      return
    }
    // 1쪽의 box.top 은 첫 페이지 위 여백이다. 그 값으로 스크롤하면 여백은
    // 문서 높이에는 있으면서 처음 화면에서는 사라진다. 1쪽은 문서 맨 위로,
    // 나머지만 페이지 시작점으로 이동한다.
    const targetTop = pageRequest.page === 1 ? 0 : box.top
    element.scrollTop = targetTop
    setScrollTop(targetTop)
  }, [boxes, contentWidth, pageRequest])

  // 지금 자리를 적어 둔다(첫 이동을 처리한 뒤부터 — 그 전의 0 으로 덮지 않게)
  useEffect(() => {
    if (viewKey === undefined || handledPageRequestRef.current === null || boxes.length === 0) return
    let index = unit !== null ? unit.first : boxes.findIndex((box) => box.top + box.height > scrollTop)
    if (index < 0) index = boxes.length - 1
    const box = boxes[index]
    if (box === undefined) return
    const fractionY = unit !== null || box.height <= 0 ? 0 : Math.min(Math.max((scrollTop - box.top) / box.height, -1), 1)
    savedPdfScrolls.delete(viewKey)
    savedPdfScrolls.set(viewKey, { page: index, fractionY, scrollLeft, request: handledPageRequestRef.current })
    if (savedPdfScrolls.size > SAVED_PDF_SCROLL_LIMIT) {
      const oldest = savedPdfScrolls.keys().next().value
      if (oldest !== undefined) savedPdfScrolls.delete(oldest)
    }
  }, [boxes, scrollLeft, scrollTop, unit, viewKey])

  // 확대·축소(또는 패널 폭)나 한 줄의 쪽 수(한 장 ↔ 두·세 장)로 배치가 바뀌면 보던 자리를 그대로 둔다.
  // Ctrl+휠이면 마우스 밑, 아니면 화면 가운데의 문서 지점(그 쪽 안의 같은 비율 자리)이 같은 화면 위치에 남도록
  // 그리기 전에(useLayoutEffect) 스크롤을 옮긴다. 쪽 수만 바뀔 때는 폭이 그대로라 예전에는 건너뛰어 자리를 잃었다.
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const previousLayoutRef = useRef<{ boxes: readonly SpreadBox[]; contentWidth: number; contentLeft: number; spread: PdfSpread } | null>(null)
  useLayoutEffect(() => {
    const previous = previousLayoutRef.current
    previousLayoutRef.current = { boxes, contentWidth, contentLeft, spread }
    const element = scrollerRef.current
    const anchor = zoomAnchorRef.current ?? { x: measured.width / 2, y: measured.height / 2 }
    zoomAnchorRef.current = null
    if (
      previous === null || element === null || previous.contentWidth <= 0 || contentWidth <= 0
      || (previous.contentWidth === contentWidth && previous.spread === spread)
      || previous.boxes.length !== boxes.length || boxes.length === 0
    ) return
    // 바뀌기 전 자리는 마지막으로 기억한 스크롤 값으로 잰다. element.scrollTop 은 이미 새(더 짧아진) 문서 높이에
    // 맞춰 잘려 있을 수 있다(한 장 → 세 장이면 문서가 1/3 로 줄어 끝으로 붙거나 맨 위로 간다).
    // 다음 프레임에 반영될 스크롤이 남아 있으면 그것이 더 새 값이다.
    const framePending = frameRef.current !== null && pendingScrollRef.current !== null
    const oldY = (framePending ? pendingScrollRef.current! : scrollTop) + anchor.y
    const oldX = (framePending ? pendingLeftRef.current : scrollLeft) + anchor.x - previous.contentLeft
    // 가운데 지점이 걸친 쪽. 여러 장이 한 줄이면 가로 자리까지 맞는 쪽, 없으면 그 줄(또는 그 아래)의 첫 쪽
    let index = previous.boxes.findIndex((box) => oldY >= box.top && oldY < box.top + box.height && oldX >= box.left && oldX < box.left + box.width)
    if (index < 0) index = previous.boxes.findIndex((box) => oldY < box.top + box.height)
    if (index < 0) index = previous.boxes.length - 1
    const before = previous.boxes[index]
    const after = boxes[index]
    if (before === undefined || after === undefined || before.height <= 0 || before.width <= 0) return
    const fractionY = Math.min(Math.max((oldY - before.top) / before.height, 0), 1)
    const fractionX = (oldX - before.left) / before.width
    const newY = after.top + fractionY * after.height
    const newX = contentLeft + after.left + fractionX * after.width
    element.scrollTop = Math.max(0, newY - anchor.y)
    element.scrollLeft = Math.max(0, newX - anchor.x)
    setScrollTop(element.scrollTop)
    setScrollLeft(element.scrollLeft)
  }, [boxes, contentWidth, measured.height, measured.width])
  const scrollableHeight = Math.max(docHeight - measured.height, 0)
  const scrollbarHeight =
    docHeight > 0 ? Math.max((measured.height / docHeight) * measured.height, 48) : measured.height
  const scrollbarTravel = Math.max(measured.height - scrollbarHeight - 16, 0)
  const scrollbarScrollTop = Math.min(Math.max(scrollTop, 0), scrollableHeight)
  const scrollbarTop =
    scrollableHeight > 0 ? 8 + (scrollbarScrollTop / scrollableHeight) * scrollbarTravel : 8

  // 막대를 누른 자리로 바로 간다(손잡이 가운데가 그 자리에 오게). 누른 채 끌면 그대로 따라온다.
  // 손잡이 위를 누르면 예전처럼 그 자리에서 잡아 끈다.
  const handleScrollbarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // 목차 제목 칸의 빈 곳은 막대가 아니다
    if ((event.target as Element).closest('.pdf-scrollbar-labels') !== null) return
    const element = scrollerRef.current
    const bar = event.currentTarget
    bar.setPointerCapture(event.pointerId)
    let startScrollTop = scrollTop
    const onThumb = (event.target as Element).closest('.pdf-scrollbar-thumb') !== null
    if (!onThumb && element !== null && scrollbarTravel > 0) {
      const y = event.clientY - bar.getBoundingClientRect().top - 8 - scrollbarHeight / 2
      startScrollTop = Math.min(Math.max((y / scrollbarTravel) * scrollableHeight, 0), scrollableHeight)
      element.scrollTop = startScrollTop
      setScrollTop(startScrollTop)
    }
    scrollDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop }
  }

  // 손 도구: 글자가 없는 곳을 잡고 끌면 화면을 옮긴다(글자 위는 SelectionLayer 가 먼저 받아 글을 고른다)
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const handlePanPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionMode !== 'hand' || event.button !== 0 || event.nativeEvent.defaultPrevented) return
    if (event.target instanceof Element
      && event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [role="button"], .selection-actions-anchor, .pdf-memo-card') !== null) return
    const element = event.currentTarget
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false }
  }
  const handlePanPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan === null || pan.pointerId !== event.pointerId) return
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    if (!pan.moved) {
      if (Math.hypot(dx, dy) < 3) return
      pan.moved = true
      if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
      document.body.classList.add('pdf-panning')
    }
    event.preventDefault()
    const element = event.currentTarget
    element.scrollLeft = pan.left - dx
    element.scrollTop = pan.top - dy
  }
  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (pan === null || pan.pointerId !== event.pointerId) return
    panRef.current = null
    document.body.classList.remove('pdf-panning')
    if (pan.moved && typeof event.currentTarget.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  useEffect(() => () => document.body.classList.remove('pdf-panning'), [])

  const flipAtRef = useRef(0)
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && unit !== null) {
      // 넘겨 보기: 화면 끝에서 더 굴리면 다음(앞) 쪽으로. 한 번 굴림에 여러 장 넘어가지 않게 잠깐 쉰다
      const element = event.currentTarget
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2
      const atTop = element.scrollTop <= 1
      const now = Date.now()
      if (now - flipAtRef.current < 350) return
      if (event.deltaY > 0 && atBottom && unit.last < pageSizes.length - 1) {
        flipAtRef.current = now
        goPaged(unit.last + 1, 'top')
      } else if (event.deltaY < 0 && atTop && unit.first > 0) {
        flipAtRef.current = now
        goPaged(unit.first - 1, 'bottom')
      }
      return
    }
    if (!event.ctrlKey || onZoomChange === undefined) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    zoomAnchorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const direction = event.deltaY < 0 ? 1 : -1
    onZoomChange(zoomScale > 0
      ? stepZoom(zoomPercent * zoomScale, direction) / zoomScale
      : stepZoom(zoomPercent, direction))
  }

  const handleScrollbarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = scrollDragRef.current
    const element = scrollerRef.current
    if (drag === null || drag.pointerId !== event.pointerId || element === null || scrollbarTravel <= 0) return
    const next = Math.min(Math.max(drag.startScrollTop + ((event.clientY - drag.startY) / scrollbarTravel) * scrollableHeight, 0), scrollableHeight)
    element.scrollTop = next
    setScrollTop(next)
  }

  const finishScrollbarDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrollDragRef.current?.pointerId !== event.pointerId) return
    scrollDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  // 스크롤 막대 위의 목차 눈금(세 단계까지). 막대에 마우스를 올리면 왼쪽에 제목이 펼쳐지고, 눌러서 그 자리로 간다
  const [outlineMarks, setOutlineMarks] = useState<readonly PdfOutlineEntry[]>([])
  useEffect(() => {
    let alive = true
    setOutlineMarks([])
    void Promise.resolve()
      .then(() => pdfOutline(docId))
      .then((entries) => {
        if (alive) setOutlineMarks(entries.filter((entry) => entry.depth <= SCROLLBAR_OUTLINE_DEPTH && entry.page !== null))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [docId])
  const scrollbarMarks = useMemo(() => {
    if (paged || scrollableHeight <= 0 || scrollbarTravel <= 0) return []
    const seen = new Set<number>()
    return outlineMarks.flatMap((entry) => {
      const box = entry.page === null ? undefined : boxes[entry.page]
      if (box === undefined) return []
      const target = Math.min(box.top, scrollableHeight)
      const y = Math.round(8 + scrollbarHeight / 2 + (target / scrollableHeight) * scrollbarTravel)
      // 같은 자리에 겹치는 눈금은 하나만(앞의 것 = 더 큰 단계)
      if (seen.has(y) || seen.has(y - 1) || seen.has(y + 1)) return []
      seen.add(y)
      return [{ entry, y, target }]
    })
  }, [boxes, outlineMarks, paged, scrollableHeight, scrollbarHeight, scrollbarTravel])
  // 제목은 겹치지 않는 것만 보인다. 큰 단계(장)부터 자리를 잡고, 남는 틈에 작은 단계를 채운다
  const scrollbarLabels = useMemo(() => {
    const placed: { entry: PdfOutlineEntry; y: number; target: number; index: number }[] = []
    const order = scrollbarMarks
      .map((mark, index) => ({ ...mark, index }))
      .sort((left, right) => left.entry.depth - right.entry.depth || left.index - right.index)
    for (const mark of order) {
      if (placed.some((other) => Math.abs(other.y - mark.y) < SCROLLBAR_LABEL_GAP)) continue
      placed.push(mark)
    }
    return placed.sort((left, right) => left.y - right.y)
  }, [scrollbarMarks])
  // 지금 보는 쪽이 속한 목차(제목 칸에서 강조)
  const currentMarkIndex = (() => {
    let found = -1
    scrollbarMarks.forEach((mark, index) => {
      if ((mark.entry.page ?? 0) <= visibleStart) found = index
    })
    return found
  })()
  const jumpTo = (target: number) => {
    const element = scrollerRef.current
    if (element === null) return
    element.scrollTop = target
    setScrollTop(target)
  }

  // ---------- 책갈피 핀 ----------
  // 막대 위 높이 ↔ 스크롤 위치(목차 눈금과 같은 셈). 핀은 그 자리를 화면 맨 위에 두는 스크롤 위치에 꽂힌다
  const trackTop = 8 + scrollbarHeight / 2
  const pinsShown = !paged && scrollableHeight > 0 && scrollbarTravel > 0
  const placedPins = useMemo<readonly PlacedPin[]>(() => {
    if (!pinsShown) return []
    return pins.flatMap((pin) => {
      const box = boxes[pin.page]
      if (box === undefined) return []
      const target = Math.min(Math.max(box.top + (pin.y ?? 0) * box.height - 6, 0), scrollableHeight)
      return [{ pin, target, y: Math.round(trackTop + (target / scrollableHeight) * scrollbarTravel) }]
    })
  }, [boxes, pins, pinsShown, scrollableHeight, scrollbarTravel, trackTop])
  const [editingPinId, setEditingPinId] = useState<string | null>(null)
  // 막대에 마우스를 올리면 그 높이에 흐린 새 핀이 따라온다
  const [ghostY, setGhostY] = useState<number | null>(null)
  const trackGhost = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (onAddPin === undefined || !pinsShown || scrollDragRef.current !== null) return
    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.min(Math.max(event.clientY - rect.top, trackTop), trackTop + scrollbarTravel)
    setGhostY(Math.round(y))
  }
  /** 막대 위 높이(px) → 그 스크롤 자리에서 화면 맨 위에 오는 쪽과 쪽 안의 높이(0–1). 핀 꽂기·옮기기가 같이 쓴다 */
  const pinPlaceAt = (barY: number): { index: number; y: number } | null => {
    if (scrollbarTravel <= 0) return null
    const target = Math.min(Math.max(((barY - trackTop) / scrollbarTravel) * scrollableHeight, 0), scrollableHeight)
    const docY = target + 6
    let index = boxes.findIndex((box) => box.top + box.height > docY)
    if (index < 0) index = boxes.length - 1
    const box = boxes[index]
    if (box === undefined) return null
    return { index, y: Math.min(Math.max((docY - box.top) / Math.max(box.height, 1), 0), 1) }
  }
  const plantPin = () => {
    if (onAddPin === undefined || ghostY === null || scrollbarTravel <= 0) return
    const place = pinPlaceAt(ghostY)
    if (place === null) return
    const { index, y } = place
    // 기본 이름: 그 자리가 속한 목차 제목, 없으면 쪽 번호
    const section = [...outlineMarks].reverse().find((entry) => entry.page !== null && entry.page <= index)
    const id = onAddPin(index, y, section?.title ?? t('{page}쪽', { page: index + 1 }))
    setGhostY(null)
    setEditingPinId(id)
  }

  useEffect(() => {
    if (pageSizes.length > 0) onPageChange?.(visibleStart + 1)
  }, [onPageChange, pageSizes.length, visibleStart])

  useEffect(() => {
    if (!hasText || renderWidth <= 0) return
    let alive = true

    for (let page = start; page <= end; page++) {
      void pageTextIndex(docId, page)
        .then((index) => {
          if (!alive) return
          setPageIndexes((previous) => {
            if (previous.has(page)) return previous
            const next = new Map(previous)
            next.set(page, index)
            return next
          })
        })
        .catch(() => {
          // 문서가 닫히는 순간의 진행 중 요청은 실패할 수 있다. 이미지 렌더와
          // 달리 선택 레이어는 보조 기능이므로 페이지 자체까지 가리지 않는다.
        })
    }

    return () => {
      alive = false
    }
  }, [docId, end, hasText, renderWidth, start])

  // 링크도 글자처럼 보이는 페이지만 읽는다. 스캔본에도 링크는 있을 수 있어서
  // hasText 와 상관없이 읽는다. 링크를 그릴 수 없는 상황이면 아예 묻지 않는다.
  const linksEnabled = onLinkNavigate !== undefined || onExternalLink !== undefined
  useEffect(() => {
    if (!linksEnabled || renderWidth <= 0) return
    let alive = true
    for (let page = start; page <= end; page++) {
      void pdfPageLinks(docId, page)
        .then((links) => {
          if (!alive || links.length === 0) return
          setPageLinks((previous) => {
            if (previous.has(page)) return previous
            const next = new Map(previous)
            next.set(page, links)
            return next
          })
        })
        .catch(() => {
          // 링크는 보조 기능이다. 못 읽으면 링크 없이 보여 준다.
        })
    }
    return () => {
      alive = false
    }
  }, [docId, end, linksEnabled, renderWidth, start])

  const handleAnchorCreated = (anchor: Anchor) => {
    setAnchors((previous) => {
      const next = new Map(previous)
      next.set(anchor.page, anchor)
      return next
    })
    onAnchorCreated?.(anchor)
  }

  const pages: JSX.Element[] = []
  // renderWidth 가 0 이면 아직 상자를 못 잰 것이다. 그 상태로 요청하면
  // 아무도 볼 수 없는 폭의 페이지를 문서 전체만큼 긁어 오게 된다.
  if (renderWidth > 0) {
    for (let page = start; page <= end; page++) {
      const box = boxes[page]
      // noUncheckedIndexedAccess: visibleRange 가 범위를 보장하지만
      // 타입 시스템은 모른다.
      if (box === undefined) continue
      const index = pageIndexes.get(page) ?? (hasText ? undefined : EMPTY_PAGE_TEXT_INDEX)
      const pageSize = pageSizes[page]
      // 돌아가기 전 페이지의 화면 크기. 그림·글자 상자·형광펜은 이 크기로 그리고,
      // 돌린 것은 바깥 칸이 맡는다.
      const innerWidth = quarterTurned ? box.height : box.width
      const innerHeight = quarterTurned ? box.width : box.height
      const renderScale = pageSize === undefined || pageSize[0] <= 0 ? 1 : innerWidth / pageSize[0]
      const rotated = rotation !== 0
      // 기기 픽셀 경계에 맞춰 놓는다 — 반 픽셀에 걸치면 그림이 다시 보간돼 흐려진다
      const snap = (value: number) => Math.round(value * ratio) / ratio
      const slotLeft = snap(contentLeft + box.left)
      const slotTop = snap(box.top)
      // 이 쪽에서 화면에 보이는 부분(쪽 기준). 안 보이면(앞뒤로 미리 그리는 쪽) null
      // 위아래로 화면 반 높이만큼 넓혀 잡는다 — 곧 들어올 쪽·줄의 타일을 미리 받아 흐린 밑그림이 비치지 않게
      const lookahead = measured.height / 2
      const visibleTop = Math.max(0, scrollTop - lookahead - slotTop)
      const visibleBottom = Math.min(innerHeight, scrollTop + measured.height + lookahead - slotTop)
      const visibleLeft = Math.max(0, scrollLeft - slotLeft)
      const visibleRight = Math.min(innerWidth, scrollLeft + measured.width - slotLeft)
      const visible = visibleBottom > visibleTop && visibleRight > visibleLeft
        ? { left: visibleLeft, top: visibleTop, right: visibleRight, bottom: visibleBottom }
        : null
      const content = (
        <>
          <PageImage
            docId={docId}
            page={page}
            cssWidth={innerWidth}
            cssHeight={innerHeight}
            pageSize={pageSize}
            devicePixelRatio={ratio}
            visible={visible}
            allowTiles={!rotated}
          />
          {index !== undefined ? (
            <SelectionLayer
              docId={docId}
              page={page}
              index={index}
              renderScale={renderScale}
              width={innerWidth}
              height={innerHeight}
              sourceTitle={title}
              pageSize={pageSize ?? [innerWidth, innerHeight]}
              mode={interactionMode}
              highlightColor={selectedHighlightColor}
              anchor={anchors.get(page) ?? (highlightAnchor?.page === page ? highlightAnchor : undefined)}
              persistentHighlights={persistentHighlightsByPage.get(page)}
              passiveHighlights={highlightsByPage.get(page)}
              searchHighlights={searchHighlightsByPage.get(page)}
              onSendToCanvas={onSendToCanvas}
              onCopyWithSource={onCopyWithSource}
              onSearchDocuments={onSearchDocuments}
              onTranslate={onTranslateSelection}
              onSendTranslationToCanvas={onSendTranslatedSelection}
              onAnchorCreated={handleAnchorCreated}
              onSelectionChange={(selection) => {
                if (selection !== null) {
                  startDraftMemo(selection)
                  return
                }
                setAnchors((previous) => {
                  if (!previous.has(page)) return previous
                  const next = new Map(previous)
                  next.delete(page)
                  return next
                })
              }}
              onPersistentHighlightCreated={onPersistentHighlightCreated}
              onPersistentHighlightRemoved={onPersistentHighlightRemoved}
              eraseHighlights={eraseHighlights}
              flashHighlightId={flashHighlightId ?? localFlashId}
              resetKey={selectionResetKey}
              onRegionHighlightResize={onPersistentHighlightUpdated === undefined || rotated
                ? undefined
                : (id, nextAnchor) => {
                    // 아직 저장 전인 새 표·그림 메모는 그 초안을, 저장된 것은 형광펜을 고친다(id 는 그대로)
                    if (draftMemo !== null && draftMemo.id === id) setDraftMemo(updatePersistentPdfHighlight(draftMemo, { anchor: nextAnchor }))
                    else onPersistentHighlightUpdated(id, { anchor: nextAnchor })
                  }}
              onPersistentHighlightActivate={onPersistentHighlightUpdated === undefined
                ? undefined
                : (id, point) => {
                    // 박스 메모의 형광펜을 누르면 그 박스를 고치기로 연다
                    if (persistentHighlights.find((item) => item.id === id)?.box !== undefined) {
                      setEditingBoxId(id)
                      return
                    }
                    // 메모 바를 켜 두었으면 노트에서 그 카드를 고치기로 연다
                    if (memoAvailable && memoColumnVisible) {
                      setDraftMemo(null)
                      showHighlightInNote(id)
                    }
                    else setOpenHighlight({ id, point })
                  }}
            />
          ) : null}
          {(interactionMode === 'text' || interactionMode === 'hand') && linksEnabled && !rotated ? (
            <LinkLayer
              links={pageLinks.get(page) ?? []}
              renderScale={renderScale}
              onInternal={(target) => onLinkNavigate?.(target.page + 1)}
              onExternal={(uri) => onExternalLink?.(uri)}
            />
          ) : null}
        </>
      )
      pages.push(
        <div
          key={page}
          data-page={page}
          className={`pdf-page-slot${rotated ? ' pdf-page-rotated' : ''}`}
          style={{
            top: `${slotTop}px`,
            left: `${slotLeft}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        >
          {rotated ? (
            <div
              className="pdf-page-rotator"
              style={{
                width: `${innerWidth}px`,
                height: `${innerHeight}px`,
                left: `${(box.width - innerWidth) / 2}px`,
                top: `${(box.height - innerHeight) / 2}px`,
                transform: `rotate(${rotation}deg)`,
              }}
            >
              {content}
            </div>
          ) : content}
        </div>,
      )
    }
  }

  return (
    <>
      {primary && noteHost && memoAvailable && (memoColumn || memoOnly) ? (() => {
        const bar = (
        <aside
          className={`pdf-memo-bar${memoOnly ? ' pdf-memo-bar-wide' : ''}`}
          aria-label={t('메모')}
          style={memoOnly ? undefined : { width: `${memoBarSize}px` }}
          data-memo-bar={docId}
        >
        {memoOnly ? null : (
          <div
            className="pdf-memo-bar-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('메모 바 너비 조절')}
            title={t('끌어서 너비 조절')}
            onPointerDown={memoBar.startResize}
            onDoubleClick={memoBar.resetSize}
          />
        )}
        <NoteBarHeader
          api={noteApi}
          fallbackTitle={noteApi === null ? t('메모') : t('노트 없음')}
          highlights={persistentHighlights}
          currentDocId={docId}
          docTitles={docTitles}
          onQueryChange={setMemoQuery}
          onPickResult={jumpToMemo}
          onAddText={noteApi === null ? undefined : addTextBlock}
          anyQuoteOpen={noteMemos.length === 0 ? undefined : noteMemos.some((highlight) => openQuotes.has(highlight.id))}
          onToggleQuotes={() => {
            // 원문을 하나라도 펼쳐 두었으면 모두 접고, 다 접혀 있으면 모두 편다(쓴 메모는 늘 보인다)
            const anyOpen = noteMemos.some((highlight) => openQuotes.has(highlight.id))
            setEditingMemoId(null)
            setOpenQuotes(anyOpen ? new Set() : new Set(noteMemos.filter((highlight) => highlight.kind !== 'region').map((highlight) => highlight.id)))
          }}
          memoOnly={memoOnly}
          onToggleMemoOnly={() => {
            setDraftMemo(null)
            setEditingMemoId(null)
            setMemoOnly((current) => !current)
          }}
          onClose={noteApi?.close === undefined ? undefined : () => {
            setDraftMemo(null)
            setEditingMemoId(null)
            setMemoOnly(false)
            noteApi.close?.()
          }}
        />
        {memoOnly ? (
          <div className="pdf-memo-only">
            <MemoListView
              title={noteApi === null ? (docTitles?.[docId] ?? t('이 PDF')) : noteApi.openTitle ?? t('노트 없음')}
              items={noteItems}
              currentDocId={docId}
              query={memoQuery}
              docTitle={(id) => docTitles?.[id] ?? ''}
              pageSizeOf={(highlight) => highlight.anchor.docId === docId ? pageSizes[highlight.anchor.page] : highlight.pageSize}
              onSave={(id, content) => onPersistentHighlightUpdated?.(id, { note: content.text, noteHtml: content.html })}
              onSaveText={saveTextBlock}
              onOpen={(highlight) => {
                setMemoOnly(false)
                window.setTimeout(() => jumpToMemo(highlight), 0)
              }}
            />
          </div>
        ) : (
          <div className="pdf-memo-bar-body" style={{ top: `${barBodyTop}px` }}>

            {(() => {
              // 형광펜(PDF 화면 좌표) → 카드(바 화면 좌표). 둘 다 보일 때만 잇는다
              const pageEdge = Math.min(contentLeft + contentWidth - scrollLeft - measured.width, 0)
              const bend = pageEdge + (MEMO_CARD_INSET - pageEdge) / 2
              const lines = memoLinkLines
              return (
                <svg className="pdf-memo-links pdf-memo-links-flow" width={memoBarSize} height={Math.max(memoBarScroll.height + dockBottom, 1)} aria-hidden="true" style={dockBottom > 0 ? { clipPath: `polygon(-4000px -4000px, 0 -4000px, 0 ${dockBottom}px, 4000px ${dockBottom}px, 4000px 4000px, -4000px 4000px)` } : undefined}>
                  {lines.map(({ target, anchorY, cardY, active }) => (
                    <g key={target.key} className={`pdf-memo-link pdf-memo-link-${target.highlight.color}${active ? ' pdf-memo-link-active' : ''}`}>
                      <path d={`M ${pageEdge} ${anchorY} C ${bend} ${anchorY}, ${bend} ${cardY}, ${MEMO_CARD_INSET} ${cardY}`} />
                    </g>
                  ))}
                </svg>
              )
            })()}
            {noteApi === null || noteApi.openPath !== null ? (
              // 서식 도구: 노트 목록(스크롤) 밖, 바 맨 위에 따로 둔다. 쓰는 칸이 없으면 꺼진 채로 보인다
              <div className="note-format-dock">
                <div className="note-format-slot" ref={setFormatSlot} />
                {draftMemo === null && editingMemoId === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
              </div>
            ) : null}
            <div
              ref={memoBarScrollRef}
              className="pdf-memo-bar-scroll"
              style={{ paddingLeft: `${MEMO_CARD_INSET}px` }}
              onScroll={(event) => {
                const element = event.currentTarget
                setMemoBarScroll({ top: element.scrollTop, height: element.clientHeight })
              }}
            >
              {noteApi !== null && noteApi.openPath === null ? (
                <div className="note-empty">
                  <p>{t('열린 노트가 없습니다.')}</p>
                  <button type="button" onClick={() => void noteApi.create()}>{t('새 노트 만들기')}</button>
                </div>
              ) : noteItems.length === 0 ? (
                <p className="note-empty-hint">{t('PDF에서 글을 끌거나, 표·그림을 영역 캡처 도구(또는 Ctrl+끌기)로 감싸면 보고 있는 자리에 메모가 생깁니다. 「＋ 글」로 노트에 직접 쓸 수도 있습니다.')}</p>
              ) : null}
              <MemoFormatSlotContext.Provider value={formatSlot}>
              <NoteFlow
                items={noteItems}
                editingKey={draftMemo !== null ? 'draft' : editingMemoId}
                activeKey={activeMemoId}
                query={memoQuery}
                pageSizeOf={(highlight) => highlight.anchor.docId === docId ? pageSizes[highlight.anchor.page] : highlight.pageSize}
                onEdit={setEditingMemoId}
                onActivate={setActiveMemoId}
                onSaveMemo={(highlightId, content, ticket) => saveMemo(highlightId, content, ticket)}
                onAddRef={noteApi === null ? undefined : (key) => {
                  setAttachKey(key)
                  if (key !== null) announceAction(t('PDF 에서 더할 원문을 고르세요'))
                }}
                onRemoveRef={noteApi === null ? undefined : (key, highlightId) => updateNote((note) => removeMemoRef(note, key, highlightId))}
                attachingKey={attachKey}
                onDeleteBlocks={noteApi === null ? undefined : deleteNoteBlocks}
                onCancelDraft={cancelDraftMemo}
                onSaveText={saveTextBlock}
                onRemoveText={(key) => updateNote((note) => removeBlock(note, key))}
                onRecolor={(id, color) => patchMemo(id, { color })}
                onDeleteMemo={(id) => {
                  setEditingMemoId(null)
                  onPersistentHighlightRemoved?.(id)
                }}
                onToggleCollapse={toggleQuote}
                openQuotes={openQuotes}
                onRate={(id, rating) => patchMemo(id, { rating })}
                onMove={(keys, beforeKey) => updateNote((note) => (typeof keys === 'string' ? [keys] : keys).reduce((current, key) => moveBlockBefore(current, key, beforeKey), note))}
                onJump={jumpToMemo}
                onCardLayout={setMemoCardLayout}
                onRenameSection={(key, title) => updateNote((note) => updateSection(note, key, { title }))}
                onToggleSection={(key, collapsed) => updateNote((note) => updateSection(note, key, { collapsed }))}
                onSetTicket={noteApi === null ? undefined : (key, ticket) => updateNote((note) => setMemoTicket(note, key, ticket))}
                onRemoveSection={(key) => updateNote((note) => removeBlock(note, key))}
                onInsertSection={noteApi === null ? undefined : (key) => insertNearBlock(key, sectionBlock(), false)}
                onInsertText={noteApi === null ? undefined : (key) => insertNearBlock(key, textBlock(), true)}
                onAppendText={noteApi === null || noteApi.openPath === null ? undefined : appendTextBlock}
              />
              </MemoFormatSlotContext.Provider>
            </div>
          </div>
        )}
        </aside>
        )
        return paneFrame === null ? bar : createPortal(bar, paneFrame)
      })() : null}
      <div
        className={`pdf-pane${interactionMode === 'hand' ? ' pdf-pane-hand' : ''}${invert ? ' pdf-pane-inverted' : ''}${!invert && tone !== 'none' ? ` pdf-pane-tone-${tone}` : ''}${paged ? ' pdf-pane-paged' : ''}${memoOnly ? ' pdf-pane-memo-hidden' : ''}`}
        style={memoBarWidth > 0 && !inSplit ? { right: `${memoBarWidth}px` } : undefined}
        data-pdf-pane={docId}
        ref={scrollerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onPointerDownCapture={(event) => {
          // 메모를 쓰던 중에 페이지를 누르면 쓰기를 끝낸다(글이 있으면 저장, 없으면 새 메모는 사라진다).
          // 페이지 쪽 누르기는 포커스를 옮기지 않아서 저절로는 끝나지 않는다
          if (draftMemo === null && editingMemoId === null && editingBoxId === null && draftBox === null) return
          // 고른 글 위 작업 메뉴(복사·번역 …)를 누르는 것은 쓰기를 끝내는 게 아니다 — 끝내면 고른 것이 풀려 단추가 듣지 않는다
          if (event.target instanceof Element && event.target.closest('.pdf-memo-card, .pdf-box-card, .selection-actions-anchor') !== null) return
          const active = document.activeElement
          if (active instanceof HTMLElement && active.closest('.pdf-memo-card, .pdf-box-card') !== null) active.blur()
        }}
      >
        {/* 전체 높이를 가진 빈 상자. 스크롤 막대의 길이는 이것 하나가 정한다 */}
        <div
          className="pdf-spacer"
          style={{ height: `${docHeight}px`, width: `${Math.max(contentWidth, measured.width)}px` }}
        >
          {pages}
          {rotation === 0 ? (() => {
            const boxMemos = [...persistentHighlights.filter((item) => item.anchor.docId === docId && item.box !== undefined), ...(draftBox === null ? [] : [draftBox])]
            if (boxMemos.length === 0) return null
            return (
              <MemoFormatSlotContext.Provider value={boxFormatSlot}>
              <PdfBoxMemos
                memos={boxMemos}
                draftId={draftBox?.id ?? null}
                editingId={editingBoxId}
                pageSizes={pageSizes}
                layoutOf={(page) => {
                  const placedBox = boxes[page]
                  return placedBox === undefined ? undefined : { top: placedBox.top, left: contentLeft + placedBox.left, width: placedBox.width }
                }}
                width={Math.max(contentWidth, measured.width)}
                height={docHeight}
                onEdit={setEditingBoxId}
                onSave={saveBoxMemo}
                onCancelDraft={() => { setDraftBox(null); setEditingBoxId(null) }}
                onChange={(id, patch) => {
                  if (draftBox !== null && id === draftBox.id) setDraftBox(updatePersistentPdfHighlight(draftBox, patch))
                  else onPersistentHighlightUpdated?.(id, patch)
                }}
                onDelete={(id) => onPersistentHighlightRemoved?.(id)}
                onSendToNote={memoAvailable ? (id) => {
                  // 박스를 거두면 보통 형광펜 메모가 된다 — 열린 노트(없으면 새 노트)에 카드로 넣는다
                  onPersistentHighlightUpdated?.(id, { box: null })
                  setEditingBoxId(null)
                  // 메모 바를 감춰 두었으면 보이게 한다(옮긴 카드가 보여야 한다)
                  if (!memoColumnVisible) setMemoBarVisible(true)
                  showHighlightInNote(id)
                } : undefined}
              />
              </MemoFormatSlotContext.Provider>
            )
          })() : null}
          {rotation === 0 && (overlays.length > 0 || interactionMode === 'edit') && onOverlayAdd !== undefined && onOverlayUpdate !== undefined && onOverlayRemove !== undefined ? (
            <PdfOverlayLayer
              overlays={overlays}
              pageSizes={pageSizes}
              layoutOf={(page) => {
                const placedBox = boxes[page]
                return placedBox === undefined ? undefined : { top: placedBox.top, left: contentLeft + placedBox.left, width: placedBox.width }
              }}
              width={Math.max(contentWidth, measured.width)}
              height={docHeight}
              editMode={interactionMode === 'edit'}
              tool={overlayTool}
              style={overlayStyle}
              onAdd={onOverlayAdd}
              onUpdate={onOverlayUpdate}
              onRemove={onOverlayRemove}
              // 지우개는 형광펜(메모)과 박스 메모도 지운다: 지나간 자리가 그 네모 안이면
              onErasePoint={onPersistentHighlightRemoved === undefined ? undefined : (page, point) => {
                const near = (rect: { x: number; y: number; w: number; h: number }) => point.x >= rect.x - 2 && point.x <= rect.x + rect.w + 2 && point.y >= rect.y - 2 && point.y <= rect.y + rect.h + 2
                for (const highlight of persistentHighlights) {
                  if (highlight.anchor.page !== page) continue
                  const box = highlight.box
                  const hit = highlight.anchor.rects.some(near) || (box !== undefined && near({ x: box.x, y: box.y, w: box.w, h: box.h ?? 48 }))
                  if (hit) {
                    if (editingMemoId === highlight.id) setEditingMemoId(null)
                    onPersistentHighlightRemoved(highlight.id)
                  }
                }
              }}
              selectedId={overlaySelectedId}
              onSelect={setOverlaySelectedId}
            />
          ) : null}
          {memoColumn && memoTargets.length > 0 ? (
            <svg className="pdf-memo-links pdf-memo-links-page" width={Math.max(contentWidth, measured.width)} height={docHeight} aria-hidden="true">
              {memoTargets.map((target) => {
                const active = target.key === activeMemoId || target.key === editingMemoId || target.draft === true
                const pageRight = contentLeft + contentWidth
                return (
                  <g key={target.highlight.id} className={`pdf-memo-link pdf-memo-link-${target.highlight.color}${active ? ' pdf-memo-link-active' : ''}`}>
                    {/* 형광펜 끝 → 페이지 가장자리 점선: 노트 쪽 선이 보이는 메모마다(가리키는 것은 진하게) */}
                    {active || linkedKeys.has(target.key) ? <path className="pdf-memo-link-inner" d={`M ${target.anchorX} ${target.anchorY} H ${pageRight}`} /> : null}
                    {active || linkedKeys.has(target.key) ? <circle cx={target.anchorX} cy={target.anchorY} r={active ? 3 : 2.2} /> : null}
                    <circle className="pdf-memo-link-edge" cx={pageRight} cy={target.anchorY} r={2} />
                  </g>
                )
              })}
            </svg>
          ) : null}
        </div>
      </div>
      {interactionMode === 'edit' && rotation === 0 ? (
        <PdfOverlayPalette
          tool={overlayTool}
          style={overlayStyle}
          onToolChange={(next) => { setOverlayTool(next); setOverlaySelectedId(null) }}
          onStyleChange={patchOverlayStyle}
          selected={overlays.find((item) => item.id === overlaySelectedId) ?? null}
          onUpdateSelected={(patch) => { if (overlaySelectedId !== null) onOverlayUpdate?.(overlaySelectedId, patch) }}
          onRemoveSelected={() => {
            if (overlaySelectedId === null) return
            onOverlayRemove?.(overlaySelectedId)
            setOverlaySelectedId(null)
          }}
          onDone={() => onInteractionModeChange?.('text')}
        />
      ) : null}
      {primary && interactionMode === 'highlight' && rotation === 0 ? (
        <HighlighterStrip onDone={() => onInteractionModeChange?.('text')} />
      ) : null}
      {primary && (interactionMode === 'box' || editingBoxId !== null || draftBox !== null) && rotation === 0 ? (
        <PdfFloatPalette
          label={t('박스 메모')}
          icon={<ChatTeardropText size={15} aria-hidden="true" />}
          hint={editingBoxId === null && draftBox === null ? t('글을 끌면 박스가 생깁니다') : undefined}
          onDone={() => {
            // 쓰던 박스가 있으면 저장하고 모드를 끝낸다
            const active = document.activeElement
            if (active instanceof HTMLElement && active.closest('.pdf-box-card') !== null) active.blur()
            onInteractionModeChange?.('text')
          }}
        >
          <div className="pdf-box-format-slot" ref={setBoxFormatSlot} />
        </PdfFloatPalette>
      ) : null}
      {scrollableHeight > 0 && (
        <div className="pdf-scrollbar" aria-hidden="true" style={memoBarWidth > 0 && !inSplit ? { right: `${memoBarWidth}px` } : undefined} onWheel={(event) => { if (!event.ctrlKey && scrollerRef.current !== null) scrollerRef.current.scrollTop += event.deltaY }} onPointerDown={handleScrollbarPointerDown} onPointerMove={(event) => { handleScrollbarPointerMove(event); trackGhost(event) }} onPointerLeave={() => setGhostY(null)} onPointerUp={finishScrollbarDrag} onPointerCancel={finishScrollbarDrag}>
          {ghostY !== null && onAddPin !== undefined ? (
            <button
              type="button"
              tabIndex={-1}
              className="pdf-pin-ghost"
              style={{ top: `${ghostY}px` }}
              title={t('책갈피 핀 꽂기')}
              aria-label={t('여기에 책갈피 핀 꽂기')}
              onPointerDown={(event) => {
                // 누르는 순간 꽂는다(떼기 전에 페이지 쪽이 포인터를 가져가면 click 이 오지 않는다)
                event.stopPropagation()
                if (event.button !== 0) return
                event.preventDefault()
                plantPin()
              }}
            >
              <PinHead />
            </button>
          ) : null}
          {scrollbarMarks.map(({ entry, y, target }) => (
            <i
              key={`${entry.page}:${entry.title}`}
              className={`pdf-scrollbar-mark pdf-scrollbar-mark-${entry.depth}`}
              style={{ top: `${y}px` }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                jumpTo(target)
              }}
            />
          ))}
          {scrollbarLabels.length > 0 && (
            <div className="pdf-scrollbar-labels">
              {scrollbarLabels.map(({ entry, y, target, index }) => (
                <button
                  key={`${entry.page}:${entry.title}`}
                  type="button"
                  tabIndex={-1}
                  className={[
                    'pdf-scrollbar-label',
                    `pdf-scrollbar-label-${entry.depth}`,
                    index === currentMarkIndex ? 'pdf-scrollbar-label-current' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ top: `${y}px` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    jumpTo(target)
                  }}
                >
                  <span className="pdf-scrollbar-label-title">{entry.title}</span>
                  <span className="pdf-scrollbar-label-page">{(entry.page ?? 0) + 1}</span>
                </button>
              ))}
            </div>
          )}
          <span className="pdf-scrollbar-thumb" style={{ height: `${scrollbarHeight}px`, transform: `translateY(${scrollbarTop}px)` }} />
        </div>
      )}
      {scrollableHeight > 0 && (
        <PdfPins
          pins={placedPins}
          editingId={editingPinId}
          onEdit={setEditingPinId}
          onJump={jumpTo}
          onUpdate={onUpdatePin}
          track={{ top: trackTop, bottom: trackTop + scrollbarTravel }}
          onMove={onMovePin === undefined ? undefined : (id, barY) => {
            const place = pinPlaceAt(barY)
            if (place !== null) onMovePin(id, place.index, place.y)
          }}
          onRemove={onRemovePin}
          style={memoBarWidth > 0 && !inSplit ? { right: `${memoBarWidth + 12}px` } : undefined}
        />
      )}
      {/* 스캔본 표시. 화면 구석에 조용히 둔다 — 사용자가 고칠 수 있는 일이
          아니라 경고할 것이 아니고, M5 에서 텍스트 발췌 메뉴가 잠길 때
          "왜 잠겼는지"를 미리 알려 두는 몫이다. */}
      {hasText ? null : <div className="pdf-scan">{t('스캔본 · 텍스트 없음')}</div>}
      {(() => {
        if (openHighlight === null || onPersistentHighlightUpdated === undefined) return null
        const highlight = persistentHighlights.find(({ id }) => id === openHighlight.id)
        if (highlight === undefined) return null
        const index = pageIndexes.get(highlight.anchor.page)
        const pageSize = pageSizes[highlight.anchor.page]
        return (
          <HighlightPopover
            highlight={highlight}
            point={openHighlight.point}
            onUpdate={onPersistentHighlightUpdated}
            onDelete={(id) => {
              onPersistentHighlightRemoved?.(id)
              setOpenHighlight(null)
            }}
            onClose={() => setOpenHighlight(null)}
            onSendToCanvas={onSendToCanvas === undefined || index === undefined || pageSize === undefined
              ? undefined
              : (target) => {
                  onSendToCanvas(createTextExcerptSelection(target.anchor, index, pageSize))
                  setOpenHighlight(null)
                }}
          />
        )
      })()}
    </>
  )
}
