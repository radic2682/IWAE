import { createPinPressTracker } from '../pdf/pinGesture'
import { defaultHighlightColorId } from '../core/highlightColors'
import { isMarkdownPath } from '../core/markdownPath'
import { getHighlightColors } from './highlightColorStyle'
import { t } from '../i18n'
import { startInternalDrag } from '../core/internalDrag'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { announceAction } from './actionFeedback'
import { MarkdownWriteLayer, markdownFitWidthZoom, markdownPaperOf, type MarkdownBoxRequest, type MarkdownRectsOf } from './MarkdownWriteLayer'

import type { MarkdownSearchHit } from './MarkdownSearchPanel'
import { PdfPins, PinHead, type PdfPinPatchInput, type PlacedPin } from '../pdf/PdfPins'
import type { PdfBookmark } from '../core/pdfBookmarks'
import { useMemoNoteApi } from '../pdf/memoNoteContext'
import { useHighlightTool } from '../pdf/highlightToolStore'
import { addMemoRef, insertBlock, memoBlock, type MemoNote, type MemoTicket } from '../core/memoNote'
import type { MemoContent } from '../pdf/MemoEditor'
import { flushPaneLinks, registerPaneLinks, type LinkItem, type PaneLinkSnapshot } from './workspaceLinks'
import { sourceTargetItems } from './sourceLinkItems'
import { getAttachRequest, setAttachRequest, useMemoHoverReporter, usePaneChannel, usePointSignalReceiver, usePublishRoutedMemoDraft, useRevealMemo, useWorkspaceLink } from './workspaceContext'
import { createPersistentPdfHighlight, updatePersistentPdfHighlight, REGION_SNAPSHOT_LIMIT } from '../pdf/persistentHighlight'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from '../pdf/persistentHighlight'
import type { OverlayPatch, PdfOverlay } from '../core/pdfOverlays'

const EMPTY_BOX_HIGHLIGHTS: readonly PersistentPdfHighlight[] = []
const EMPTY_OVERLAYS: readonly PdfOverlay[] = []
const EMPTY_PINS: readonly PdfBookmark[] = []

import { renderMarkdown, resolveMarkdownLink, resolveRelativePath } from '../core/markdown'
import {
  MARKDOWN_EXCERPT_DRAG_MIME,
  serializeMarkdownExcerptDrag,
  type MarkdownExcerptDragPayload,
  type MarkdownExcerptFormat,
  type MarkdownSourceJumpRequest,
} from '../core/markdownExcerpt'
import type { VisibleSourceReference } from '../core/workspaceSources'
import { createMarkdownCapture, markdownSourceHash } from '../core/markdownCapture'
import { sourceForNewText } from '../ui/translationPair'
import {
  createPersistentMarkdownHighlight,
  type PersistentMarkdownHighlight,
} from '../core/markdownHighlight'
import { getMarkdownTheme, type MarkdownThemeId } from '../core/markdownTheme'
import type { ReaderPaneToolMode } from './PaneToolbar'
import '../ui/sidebar-followup.css'
import { ContextMenu } from '../ui/ContextMenu'
import { menuGuardActive } from './menuGuard'
import { TranslationCard, useEffectiveTargetLanguage } from '../ui/TranslationCard'
import { publishReaderSelection } from './readerSelectionStore'
import { documentContextEntries } from '../ui/documentContextMenu'

interface MarkdownPaneProps {
  title: string
  source: string
  path?: string
  sourceFileId?: string
  sourceHighlights?: readonly VisibleSourceReference[]
  jumpRequest?: MarkdownSourceJumpRequest | null
  onJumpHandled?: () => void
  theme?: MarkdownThemeId
  interactionMode?: ReaderPaneToolMode
  searchQuery?: string
  onTranslateSelection?: (text: string, options?: { readonly force?: boolean; readonly targetLanguage?: string; readonly sourceLanguage?: string }) => Promise<MarkdownSelectionTranslation | null>
  onSendTranslatedSelection?: (
    payload: MarkdownExcerptDragPayload,
    translation: MarkdownSelectionTranslation,
  ) => void
  persistentHighlights?: readonly PersistentMarkdownHighlight[]
  onPersistentHighlightCreated?: (highlight: PersistentMarkdownHighlight) => void
  onPersistentHighlightRemoved?: (highlightId: string) => void
  /** Vault 폴더 절대 경로. path 가 Vault 상대 경로일 때 그림 파일을 찾는 기준 */
  vaultRoot?: string
  /** 다른 Markdown 문서 링크(상대 경로를 푼 Vault 경로)를 눌렀다 */
  onOpenDocument?: (path: string, anchor: string | null) => void
  /** 바깥 주소 링크를 눌렀다 */
  onExternalLink?: (url: string) => void
  /** 배율(%) — 종이 폭과 글자 크기가 함께 커진다(PDF 의 배율과 같은 뜻) */
  readonly zoom?: number
  /** Ctrl+휠로 배율을 바꿨다 */
  readonly onZoomChange?: (zoom: number) => void
  /** 폭 맞춤: 창 폭이 바뀌면 종이가 양옆 12px 만 남기고 꽉 차는 배율을 알린다 */
  readonly fitWidth?: boolean
  readonly onFitZoom?: (zoom: number) => void
  /** 지금 절(제목) 차례와 절 수가 바뀌었다(아래 막대의 「쪽」 칸) */
  readonly onSectionsChange?: (current: number, count: number) => void
  /** 이 절(0 부터)로 가라. nonce 가 바뀔 때마다 */
  readonly sectionRequest?: { readonly index: number; readonly nonce: number } | null
  /** 박스 메모(PDF 와 같은 형광펜 + 선으로 이은 메모 상자). 이 문서의 것만 그린다(docId = 경로) */
  readonly boxHighlights?: readonly PersistentPdfHighlight[]
  readonly onBoxHighlightCreated?: (highlight: PersistentPdfHighlight) => void
  readonly onBoxHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  readonly onBoxHighlightRemoved?: (id: string) => void
  /** 편집(글 상자·펜·지우개·선) */
  readonly overlays?: readonly PdfOverlay[]
  readonly onOverlayAdd?: (overlay: PdfOverlay) => void
  readonly onOverlayUpdate?: (id: string, patch: OverlayPatch) => void
  readonly onOverlayRemove?: (id: string) => void
  /** 도구창 「완료」 */
  readonly onInteractionModeChange?: (mode: ReaderPaneToolMode) => void
  /** 고른 글자로 문서 검색(PDF 의 「문서 검색」과 같다) */
  readonly onSearchDocuments?: (text: string) => void
  /** 깨끗이 보기: 내가 단 표시(형광펜·메모 칠·박스 메모·쓴 글·책갈피)를 감춘다 */
  readonly clean?: boolean
  /** 본문에 칠한 검색 자리들(왼쪽 바 검색 목록). 처음 자리는 지금 보는 곳부터 */
  readonly onSearchHits?: (hits: readonly MarkdownSearchHit[], startIndex: number) => void
  /** 이 검색 자리(0 부터)로 가라 */
  readonly searchJump?: { readonly index: number; readonly nonce: number } | null
  /** 화면 나누기에서 주 칸인가(검색 목록·읽던 자리는 주 칸만). 기본은 주 칸 */
  readonly primary?: boolean
  /** 책갈피 핀(스크롤 막대 옆). 쪽은 늘 0, y 는 문서 전체 높이에 대한 비율 */
  readonly pins?: readonly PdfBookmark[]
  readonly onAddPin?: (page: number, y: number, title: string) => string
  readonly onUpdatePin?: (id: string, patch: PdfPinPatchInput) => void
  readonly onMovePin?: (id: string, page: number, y: number) => string
  readonly onRemovePin?: (id: string) => void
}

/** 그림 파일 → blob 주소. 같은 그림을 탭을 바꿀 때마다 다시 읽지 않게 둔다 */
const markdownImageUrls = new Map<string, Promise<string | null>>()
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
}
function loadMarkdownImage(absolutePath: string): Promise<string | null> {
  const cached = markdownImageUrls.get(absolutePath)
  if (cached !== undefined) return cached
  const loading = (async () => {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const bytes = await readFile(absolutePath)
      const extension = absolutePath.split('.').at(-1)?.toLowerCase() ?? ''
      return URL.createObjectURL(new Blob([bytes], { type: IMAGE_TYPES[extension] ?? 'application/octet-stream' }))
    } catch {
      markdownImageUrls.delete(absolutePath)
      return null
    }
  })()
  markdownImageUrls.set(absolutePath, loading)
  return loading
}

export interface MarkdownSelectionTranslation {
  readonly text: string
  readonly targetLanguage: string
  readonly model: string
}

interface SelectionAction {
  readonly payload: MarkdownExcerptDragPayload
  readonly left: number
  readonly top: number
}

type TranslationActionState =
  | { readonly status: 'idle' | 'pending' }
  | { readonly status: 'result'; readonly translation: MarkdownSelectionTranslation }
  | { readonly status: 'error'; readonly message: string }

interface SourceMarker {
  readonly blockId: string
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface LassoRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface HighlightAction {
  readonly id: string
  readonly left: number
  readonly top: number
}

const CONTEXT_LENGTH = 48
const EMPTY_SOURCE_HIGHLIGHTS: readonly VisibleSourceReference[] = []

function highlightMarkdownSearch(html: string, rawQuery: string): { readonly html: string; readonly count: number } {
  const query = rawQuery.trim()
  if (query === '') return { html, count: 0 }
  const template = document.createElement('template')
  template.innerHTML = html
  const nodes: Text[] = []
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const normalizedQuery = query.toLocaleLowerCase()
  let count = 0
  for (const node of nodes) {
    const text = node.data
    const normalizedText = text.toLocaleLowerCase()
    let cursor = 0
    let match = normalizedText.indexOf(normalizedQuery)
    if (match < 0) continue
    const fragment = document.createDocumentFragment()
    while (match >= 0) {
      if (match > cursor) fragment.append(text.slice(cursor, match))
      const mark = document.createElement('mark')
      mark.className = 'markdown-search-hit'
      mark.textContent = text.slice(match, match + query.length)
      fragment.append(mark)
      count += 1
      cursor = match + query.length
      match = normalizedText.indexOf(normalizedQuery, cursor)
    }
    if (cursor < text.length) fragment.append(text.slice(cursor))
    node.replaceWith(fragment)
  }
  return { html: template.innerHTML, count }
}

function highlightMarkdownRanges(
  html: string,
  highlights: readonly PersistentMarkdownHighlight[],
): string {
  if (highlights.length === 0) return html
  const template = document.createElement('template')
  template.innerHTML = html
  const nodes: Text[] = []
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let consumed = 0
  for (const node of nodes) {
    const nodeStart = consumed
    const nodeEnd = nodeStart + node.data.length
    consumed = nodeEnd
    const intersecting = highlights.filter(({ selection }) => (
      selection.startOffset < nodeEnd && selection.endOffset > nodeStart
    ))
    if (intersecting.length === 0) continue
    const boundaries = new Set([0, node.data.length])
    for (const { selection } of intersecting) {
      boundaries.add(Math.max(0, selection.startOffset - nodeStart))
      boundaries.add(Math.min(node.data.length, selection.endOffset - nodeStart))
    }
    const sorted = [...boundaries].sort((left, right) => left - right)
    const fragment = document.createDocumentFragment()
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index]
      const end = sorted[index + 1]
      if (start === undefined || end === undefined || end <= start) continue
      const text = node.data.slice(start, end)
      const active = intersecting.find(({ selection }) => (
        selection.startOffset <= nodeStart + start && selection.endOffset >= nodeStart + end
      ))
      if (active === undefined) {
        fragment.append(text)
        continue
      }
      const mark = document.createElement('mark')
      mark.className = 'markdown-persistent-highlight'
      mark.dataset.hl = active.color
      mark.dataset.markdownHighlightId = active.id
      mark.textContent = text
      fragment.append(mark)
    }
    node.replaceWith(fragment)
  }
  return template.innerHTML
}

function rangeBounds(range: Range): Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width' | 'height'> {
  return typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : { left: 0, top: 0, bottom: 0, width: 0, height: 0 }
}

function semanticFormat(node: Node, root: HTMLElement): MarkdownExcerptFormat {
  const element = semanticElement(node, root)
  if (element === null || element === undefined || !root.contains(element)) return 'paragraph'
  if (element.matches('h1')) return 'heading-1'
  if (element.matches('h2')) return 'heading-2'
  if (element.matches('h3')) return 'heading-3'
  if (element.matches('h4')) return 'heading-4'
  if (element.matches('li')) return 'list'
  if (element.matches('blockquote')) return 'quote'
  if (element.matches('pre, code')) return 'code'
  return 'paragraph'
}

function semanticElement(node: Node, root: HTMLElement): Element | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const element = start?.closest('h1, h2, h3, h4, h5, h6, li, blockquote, pre, code, p') ?? null
  return element !== null && root.contains(element) ? element : null
}

function renderedSelectionSnapshot(range: Range, root: HTMLElement): string {
  const snapshot = document.createElement('div')
  const structure = semanticElement(range.startContainer, root)
  if (structure === null || !structure.contains(range.endContainer)) {
    snapshot.append(range.cloneContents())
    return snapshot.innerHTML
  }

  const wrapper = document.createElement(structure.tagName.toLocaleLowerCase())
  if (structure.className !== '') wrapper.className = structure.className
  wrapper.append(range.cloneContents())
  snapshot.append(wrapper)
  return snapshot.innerHTML
}

function rangeOffsets(root: HTMLElement, range: Range): { startOffset: number; endOffset: number } | null {
  const quote = range.toString()
  if (quote.trim() === '') return null
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const rootText = root.textContent ?? ''
  let startOffset = before.toString().length
  if (rootText.slice(startOffset, startOffset + quote.length) !== quote) {
    const located = rootText.indexOf(quote)
    if (located < 0) return null
    startOffset = located
  }
  return { startOffset, endOffset: startOffset + quote.length }
}

function rangeFromOffsets(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let start = 0
  let end = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const next = consumed + node.data.length
    if (startNode === null && startOffset >= consumed && startOffset <= next) {
      startNode = node
      start = Math.min(startOffset - consumed, node.data.length)
    }
    if (endOffset >= consumed && endOffset <= next) {
      endNode = node
      end = Math.min(endOffset - consumed, node.data.length)
      break
    }
    consumed = next
  }
  if (startNode === null || endNode === null) return null
  const range = document.createRange()
  range.setStart(startNode, start)
  range.setEnd(endNode, end)
  return range
}

function selectionPayload(
  root: HTMLElement,
  path: string,
  sourceFileId: string,
  title: string,
  range: Range,
  sourceHash: string,
  measuredBounds?: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width' | 'height'>,
): MarkdownExcerptDragPayload | null {
  if (!root.contains(range.commonAncestorContainer)) return null
  const offsets = rangeOffsets(root, range)
  if (offsets === null) return null
  const quote = range.toString()
  const rootText = root.textContent ?? ''
  const rect = measuredBounds ?? rangeBounds(range)
  const width = Math.max(rect.width, 180)
  const height = Math.max(rect.height, 40)
  return {
    selection: {
      path,
      title,
      quote,
      prefix: rootText.slice(Math.max(0, offsets.startOffset - CONTEXT_LENGTH), offsets.startOffset),
      suffix: rootText.slice(offsets.endOffset, offsets.endOffset + CONTEXT_LENGTH),
      ...offsets,
      format: semanticFormat(range.startContainer, root),
    },
    capture: createMarkdownCapture({
      sourceFileId,
      sourceHash,
      anchor: offsets,
      plainText: quote,
      renderedSnapshot: renderedSelectionSnapshot(range, root),
      width,
      height,
    }),
    displaySize: {
      width,
      height,
    },
  }
}

function normalizedRect(left: number, top: number, right: number, bottom: number): LassoRect {
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  }
}

function rectIntersects(selection: LassoRect, rect: DOMRect): boolean {
  return rect.right >= selection.left
    && rect.left <= selection.left + selection.width
    && rect.bottom >= selection.top
    && rect.top <= selection.top + selection.height
}

function putDragPayload(event: DragEvent, payload: MarkdownExcerptDragPayload): void {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(MARKDOWN_EXCERPT_DRAG_MIME, serializeMarkdownExcerptDrag(payload))
  event.dataTransfer.setData('text/plain', payload.selection.quote)
}

export function MarkdownPane({
  title,
  source,
  path = title,
  sourceFileId = path,
  sourceHighlights = EMPTY_SOURCE_HIGHLIGHTS,
  jumpRequest = null,
  onJumpHandled,
  theme = 'light',
  interactionMode = 'text',
  searchQuery = '',
  onTranslateSelection,
  onSendTranslatedSelection,
  persistentHighlights = [],
  onPersistentHighlightCreated,
  onPersistentHighlightRemoved,
  vaultRoot,
  onOpenDocument,
  onExternalLink,
  zoom = 100,
  onZoomChange,
  fitWidth = false,
  onFitZoom,
  onSectionsChange,
  sectionRequest = null,
  boxHighlights = EMPTY_BOX_HIGHLIGHTS,
  onBoxHighlightCreated,
  onBoxHighlightUpdated,
  onBoxHighlightRemoved,
  overlays = EMPTY_OVERLAYS,
  onOverlayAdd,
  onOverlayUpdate,
  onOverlayRemove,
  onInteractionModeChange,
  onSearchDocuments,
  clean = false,
  onSearchHits,
  searchJump = null,
  primary = true,
  pins = EMPTY_PINS,
  onAddPin,
  onUpdatePin,
  onMovePin,
  onRemovePin,
}: MarkdownPaneProps) {
  const html = useMemo(() => renderMarkdown(source), [source])
  const sourceHash = useMemo(() => markdownSourceHash(source), [source])
  const activeHighlights = useMemo(() => persistentHighlights.filter((highlight) => (
    highlight.sourceFileId === sourceFileId
      && highlight.sourceHash === sourceHash
      && highlight.selection.path === path
  )), [path, persistentHighlights, sourceFileId, sourceHash])
  const highlightedHtml = useMemo(
    () => highlightMarkdownRanges(html, activeHighlights),
    [activeHighlights, html],
  )
  const search = useMemo(
    () => highlightMarkdownSearch(highlightedHtml, searchQuery),
    [highlightedHtml, searchQuery],
  )
  const markdownTheme = getMarkdownTheme(theme)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)
  const [action, setAction] = useState<SelectionAction | null>(null)
  const [translationState, setTranslationState] = useState<TranslationActionState>({ status: 'idle' })
  // 상대 경로 그림을 파일에서 읽어 붙인다(그린 HTML 이 바뀔 때마다 — 검색·형광펜도 HTML 을 다시 만든다)
  const filePath = /^(?:[a-z]:[\\/]|[\\/])/iu.test(path) || vaultRoot === undefined ? path : `${vaultRoot.replace(/[\\/]+$/u, '')}/${path}`
  useEffect(() => {
    const article = articleRef.current
    if (article === null) return
    let alive = true
    for (const image of article.querySelectorAll<HTMLImageElement>('img[data-md-src]')) {
      const relative = image.dataset.mdSrc ?? ''
      const absolute = resolveRelativePath(relative, filePath.replaceAll('\\', '/'))
      if (absolute === null) continue
      void loadMarkdownImage(absolute).then((url) => {
        if (alive && url !== null && image.isConnected) image.src = url
      })
    }
    return () => { alive = false }
  })
  const [markers, setMarkers] = useState<readonly SourceMarker[]>([])
  const [layoutRevision, setLayoutRevision] = useState(0)
  // 글 영역의 크기가 바뀌면(창 폭·화면 나누기·배율) 다음 그림에서 형광펜 자리를 다시 잰다
  const [articleLayoutKey, setArticleLayoutKey] = useState(0)
  // 왼쪽 바 책갈피를 누르면 그 자리로(스크롤 막대 핀과 같은 비율)
  useEffect(() => {
    if (!primary) return undefined
    const go = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; y: number }>).detail
      const article = articleRef.current
      if (detail?.path !== path || article === null) return
      article.scrollTo({ top: Math.max(detail.y * article.scrollHeight - article.clientHeight / 3, 0), behavior: 'smooth' })
    }
    window.addEventListener('iwae:md-pin-go', go)
    return () => window.removeEventListener('iwae:md-pin-go', go)
  }, [path, primary])
  useEffect(() => {
    const article = articleRef.current
    if (article === null) return undefined
    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => setArticleLayoutKey((value) => value + 1))
    })
    observer.observe(article)
    if (article.firstElementChild !== null) observer.observe(article.firstElementChild)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [search.html])
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null)
  const [highlightAction, setHighlightAction] = useState<HighlightAction | null>(null)
  // 떠 있는 형광펜 도구(PDF 와 같다): 색, 지우개
  const [highlightTool, setHighlightTool] = useHighlightTool()
  const highlightColor = highlightTool.color
  const eraseHighlights = highlightTool.erase
  useEffect(() => { if (interactionMode !== 'highlight') setHighlightTool({ erase: false }) }, [interactionMode, setHighlightTool])
  const lassoStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null)
  // 끌지 않은 우클릭으로 연 문서 메뉴(그때 고른 글)
  const [docMenu, setDocMenu] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => {
    const clearSelectionOutside = (event: PointerEvent) => {
      const host = hostRef.current
      const target = event.target as Node | null
      if (host === null || target === null || host.contains(target)) return
      setAction(null)
      setTranslationState({ status: 'idle' })
      window.getSelection()?.removeAllRanges()
    }
    document.addEventListener('pointerdown', clearSelectionOutside)
    return () => document.removeEventListener('pointerdown', clearSelectionOutside)
  }, [])

  // ---------- 노트 ----------
  // 노트는 같은 색 창의 메모 노트 탭이 보인다(노트 바는 없다). 이 창은 형광펜과 새 메모 초안을 맡는다
  const [draftMemo, setDraftMemo] = useState<PersistentPdfHighlight | null>(null)
  /** 연결선을 굵은 실선으로 보일 형광펜(가리킨 뒤 잠깐) */
  const linkActiveRef = useRef<string | null>(null)
  const jumpToMemo = (highlight: PersistentPdfHighlight) => {
    if (highlight.anchor.docId !== path) return
    linkActiveRef.current = highlight.id
    flushPaneLinks()
    window.setTimeout(() => {
      if (linkActiveRef.current !== highlight.id) return
      linkActiveRef.current = null
      flushPaneLinks()
    }, 1400)
    const rect = rectsOf(highlight.anchor.charRange)[0]
    const article = articleRef.current
    if (rect === undefined || article === null) return
    const paper = markdownPaperOf(article, zoom)
    article.scrollTo({ top: Math.max(rect.y * paper.scale - article.clientHeight / 3, 0), behavior: 'smooth' })
  }

  // 폭 맞춤: 글 영역 폭이 바뀔 때마다 배율을 다시 맞춘다
  useEffect(() => {
    const article = articleRef.current
    if (!fitWidth || article === null || onFitZoom === undefined) return undefined
    const fit = () => {
      const next = markdownFitWidthZoom(article.clientWidth)
      if (Math.abs(next - zoom) > 0.05) onFitZoom(next)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(article)
    return () => observer.disconnect()
  }, [fitWidth, onFitZoom, zoom])

  // ---------- 쓰기 층(박스 메모·편집): 글자 위치 → 종이 좌표 ----------
  const [boxRequest, setBoxRequest] = useState<MarkdownBoxRequest | null>(null)
  const rectsOf = useCallback<MarkdownRectsOf>((charRange) => {
    const article = articleRef.current
    if (article === null) return []
    const range = rangeFromOffsets(article, charRange[0], charRange[1])
    if (range === null) return []
    const box = article.getBoundingClientRect()
    const paper = markdownPaperOf(article, zoom)
    return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5).map((rect) => ({
      x: (rect.left - box.left - paper.left) / paper.scale,
      y: (rect.top - box.top + article.scrollTop) / paper.scale,
      w: rect.width / paper.scale,
      h: rect.height / paper.scale,
    }))
  }, [zoom])

  const noteApi = useMemoNoteApi()
  // 작업 공간: 새 메모는 같은 색 창에 보이는 메모 노트 탭으로 가고(없으면 노트를 옆에 열어서), 가리키기 신호를 받고 보낸다
  const workspace = useWorkspaceLink()
  const { pane: paneId, channel: paneChannel } = usePaneChannel()
  /** 형광펜의 카드를 노트에서 보인다: 같은 색 창에 노트가 보이면 신호로, 아니면 그 메모의 노트를 옆에 열고 */
  const revealMemo = useRevealMemo()
  // 메모가 달린 자리 위에 마우스를 올리면: 누를 때 움직일 같은 색 창에 윤곽(프레임마다 한 번만 맞춰 본다)
  const reportMemoHover = useMemoHoverReporter()
  const memoHoverFrame = useRef<number | null>(null)
  const memoHoverId = useRef<string | null>(null)
  /** 기다리는 프레임이 있으면 거둔다(마우스가 떠났거나 창이 사라졌는데 뒤늦게 윤곽이 켜지지 않게) */
  const cancelMemoHoverFrame = useCallback(() => {
    if (memoHoverFrame.current === null) return
    cancelAnimationFrame(memoHoverFrame.current)
    memoHoverFrame.current = null
  }, [])
  useEffect(() => cancelMemoHoverFrame, [cancelMemoHoverFrame])
  /** 새 메모의 초안이 가는 노트(만드는 동안): 같은 색 창의 노트 탭이거나 옆에 막 연 노트 */
  const [draftNotePath, setDraftNotePath] = useState<string | null>(null)
  /** 만든 초안을 노트로 보낸다: 같은 색 창에 보이는 노트(없으면 노트를 옆에 열어서) */
  const routeDraft = (draft: PersistentPdfHighlight) => {
    const begin = (notePath: string) => {
      setDraftNotePath(notePath)
      setDraftMemo(draft)
    }
    const routed = workspace.memoNoteTargetFor(paneId)
    if (routed !== null) begin(routed)
    else void workspace.openNoteBeside(paneId).then((notePath) => { if (notePath !== null) begin(notePath) })
  }
  const cancelRoutedDraft = () => {
    setDraftMemo(null)
    setDraftNotePath(null)
  }
  /** 노트 탭에서 쓰던 새 메모 저장(글이 비면 사라지고 표·그림은 남는다) */
  const saveRoutedDraft = (content: MemoContent, ticket: MemoTicket | undefined, index: number) => {
    const draft = draftMemo
    const notePath = draftNotePath
    if (draft === null || notePath === null || noteApi === null) return
    setDraftMemo(null)
    setDraftNotePath(null)
    if (content.text.trim() === '' && draft.kind !== 'region') return
    onBoxHighlightCreated?.(updatePersistentPdfHighlight(draft, { note: content.text, noteHtml: content.html }))
    const insert = (note: MemoNote) => insertBlock(note, memoBlock(draft.id, ticket), index)
    noteApi.updateNoteAt(notePath, insert)
  }
  usePublishRoutedMemoDraft(draftMemo, draftNotePath, {
    save: saveRoutedDraft,
    cancel: cancelRoutedDraft,
    patch: (patch) => { if (draftMemo !== null) setDraftMemo(updatePersistentPdfHighlight(draftMemo, patch)) },
  })
  // 이 자리의 메모(글 형광펜·영역)가 있으면 그것: 누르면 같은 색 창이 그 메모로 간다
  const memoAtPoint = (clientX: number, clientY: number): PersistentPdfHighlight | null => {
    const article = articleRef.current
    if (article === null) return null
    const box = article.getBoundingClientRect()
    const paper = markdownPaperOf(article, zoom)
    const x = (clientX - box.left - paper.left) / paper.scale
    const y = (clientY - box.top + article.scrollTop) / paper.scale
    return boxHighlights.find((item) => item.anchor.docId === path && item.box === undefined
      && (item.kind === 'region' ? item.anchor.rects : rectsOf(item.anchor.charRange)).some((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)) ?? null
  }
  // ---------- 연결선: 보이는 형광펜의 사각형을 작업 공간 층에 내놓는다(workspaceLinks, PDF 와 같다) ----------
  // 글자 위치 → 종이 좌표 계산(가장 무겁다)은 배치가 바뀔 때만 하고, 스크롤은 그 값에 화면 자리를 더해 보이는 것만 거른다
  const linkMarksRef = useRef<{ readonly highlights: readonly PersistentPdfHighlight[]; readonly zoom: number; readonly layout: number; readonly html: string; readonly marks: readonly { readonly highlight: PersistentPdfHighlight; readonly x0: number; readonly x1: number; readonly y: number; readonly y0: number; readonly y1: number }[] } | null>(null)
  const linkSourceRef = useRef({ boxHighlights, zoom, articleLayoutKey, html: search.html, rectsOf })
  linkSourceRef.current = { boxHighlights, zoom, articleLayoutKey, html: search.html, rectsOf }
  useLayoutEffect(() => {
    if (paneId === null || !primary) return undefined
    const measure = (): PaneLinkSnapshot | null => {
      const article = articleRef.current
      if (article === null) return null
      const source = linkSourceRef.current
      let cache = linkMarksRef.current
      if (cache === null || cache.highlights !== source.boxHighlights || cache.zoom !== source.zoom || cache.layout !== source.articleLayoutKey || cache.html !== source.html) {
        const marks: { highlight: PersistentPdfHighlight; x0: number; x1: number; y: number; y0: number; y1: number }[] = []
        for (const highlight of source.boxHighlights) {
          if (highlight.anchor.docId !== path || highlight.box !== undefined) continue
          const region = highlight.kind === 'region' ? highlight.anchor.rects[0] : undefined
          const rects = region === undefined ? source.rectsOf(highlight.anchor.charRange) : [region]
          if (rects.length === 0) continue
          const top = Math.min(...rects.map((rect) => rect.y))
          const line = rects.filter((rect) => rect.y < top + 2)
          const outset = region === undefined ? 0 : 4
          marks.push({
            highlight,
            x0: Math.min(...line.map((rect) => rect.x)) - outset,
            x1: Math.max(...line.map((rect) => rect.x + rect.w)) + outset,
            // 글: 첫 줄 위 가장자리에서(같은 줄 뒷글자를 가로지르지 않게). 영역: 위 꺾쇠 근처
            y: top + (region === undefined ? -1.5 : 8),
            y0: top,
            y1: Math.max(...line.map((rect) => rect.y + rect.h)),
          })
        }
        cache = { highlights: source.boxHighlights, zoom: source.zoom, layout: source.articleLayoutKey, html: source.html, marks }
        linkMarksRef.current = cache
      }
      const box = article.getBoundingClientRect()
      const frame = (article.closest<HTMLElement>('.pane-grid-body, .pane') ?? article).getBoundingClientRect()
      const paper = markdownPaperOf(article, source.zoom)
      const items: LinkItem[] = []
      for (const mark of cache.marks) {
        const y = box.top - article.scrollTop + mark.y * paper.scale
        if (y < box.top || y > box.bottom) continue
        items.push({
          id: mark.highlight.id,
          color: mark.highlight.color,
          y,
          rect: {
            left: box.left + paper.left + mark.x0 * paper.scale,
            right: box.left + paper.left + mark.x1 * paper.scale,
            top: box.top - article.scrollTop + mark.y0 * paper.scale,
            bottom: box.top - article.scrollTop + mark.y1 * paper.scale,
          },
        })
      }
      // 이웃한 캔버스 블록의 출처 자리
      items.push(...sourceTargetItems(hostRef.current ?? article, 'data-markdown-source-target', box))
      return {
        frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom },
        body: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        items,
        activeIds: linkActiveRef.current === null ? [] : [linkActiveRef.current],
      }
    }
    return registerPaneLinks({ pane: paneId, role: 'document', channel: paneChannel, docId: path }, measure)
  }, [paneId, paneChannel, primary, path])
  // 스크롤·배율·창 크기로 다시 그려질 때마다 같은 프레임 안에서 층을 맞춘다
  useLayoutEffect(() => { flushPaneLinks() })
  // 가리키기 신호: 같은 색 창에서 누른 메모가 이 문서에 있으면 그 자리로 굴려 가서(나머지는 jumpToMemo) 기다렸다 간다
  const [pendingPoint, setPendingPoint] = useState<PersistentPdfHighlight | null>(null)
  usePointSignalReceiver((signal) => {
    if (signal.target.kind !== 'memo') return false
    const memoId = signal.target.memoId
    const highlight = boxHighlights.find((item) => item.id === memoId)
    if (highlight === undefined || highlight.anchor.docId !== path) return false
    setPendingPoint(highlight)
    return true
  }, path)
  useEffect(() => {
    if (pendingPoint === null || articleRef.current === null || (pendingPoint.kind !== 'region' && rectsOf(pendingPoint.anchor.charRange).length === 0)) return
    setPendingPoint(null)
    jumpToMemo(pendingPoint)
  })

  const captureSelection = useCallback(() => {
    // 메모에 원문을 더하는 중: 고른 글을 그 메모 블록의 원문으로 단다
    const attach = getAttachRequest()
    if (attach !== null && interactionMode === 'text') {
      const root = articleRef.current
      const selection = window.getSelection()
      if (root !== null && selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) {
        const offsets = rangeOffsets(root, selection.getRangeAt(0))
        if (offsets !== null && selection.toString().trim() !== '') {
          const charRange: [number, number] = [offsets.startOffset, offsets.endOffset]
          const highlight = createPersistentPdfHighlight({
            docId: path,
            page: 0,
            coordSpace: 'pdfium-page',
            rects: rectsOf(charRange),
            charRange,
            quote: selection.toString(),
            prefix: '',
            suffix: '',
          }, defaultHighlightColorId(getHighlightColors()), { createdAt: new Date().toISOString(), source: 'iwae' })
          const existing = boxHighlights.find((item) => item.id === highlight.id)
          if (existing === undefined) onBoxHighlightCreated?.(highlight)
          noteApi?.updateNoteAt(attach.path, (note) => addMemoRef(note, attach.key, existing?.id ?? highlight.id))
          setAttachRequest(null)
          selection.removeAllRanges()
          announceAction(t('메모에 원문을 더했습니다'))
        }
      }
      return
    }
    // 박스 메모 모드: 고른 글로 박스를 만든다(쓰기 층이 받는다)
    if (interactionMode === 'box') {
      const root = articleRef.current
      const selection = window.getSelection()
      if (root === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) return
      const offsets = rangeOffsets(root, selection.getRangeAt(0))
      if (offsets === null) return
      setBoxRequest({ nonce: Date.now(), charRange: [offsets.startOffset, offsets.endOffset], quote: selection.toString() })
      selection.removeAllRanges()
      return
    }
    if (interactionMode !== 'text' && interactionMode !== 'highlight') return
    // 고른 글로 노트 메모를 만든다(PDF 와 같다): 같은 색 창에 보이는 노트로, 없으면 노트를 옆에 열어서
    if (interactionMode === 'text' && onBoxHighlightCreated !== undefined) {
      const root = articleRef.current
      const selection = window.getSelection()
      if (root !== null && selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) {
        const offsets = rangeOffsets(root, selection.getRangeAt(0))
        if (offsets !== null) {
          const charRange: [number, number] = [offsets.startOffset, offsets.endOffset]
          routeDraft(createPersistentPdfHighlight({
            docId: path,
            page: 0,
            coordSpace: 'pdfium-page',
            rects: rectsOf(charRange),
            charRange,
            quote: selection.toString(),
            prefix: '',
            suffix: '',
          }, defaultHighlightColorId(getHighlightColors()), { createdAt: new Date().toISOString(), source: 'iwae' }))
        }
      }
    }
    const root = articleRef.current
    const host = hostRef.current
    const selection = window.getSelection()
    if (root === null || host === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      setAction(null)
      setTranslationState({ status: 'idle' })
      return
    }
    const range = selection.getRangeAt(0)
    const payload = selectionPayload(root, path, sourceFileId, title, range, sourceHash)
    if (payload === null) {
      setAction(null)
      setTranslationState({ status: 'idle' })
      return
    }
    if (interactionMode === 'highlight') {
      // 지우개를 켠 동안은 칠하지 않는다(누른 형광펜을 지운다)
      if (eraseHighlights) {
        window.getSelection()?.removeAllRanges()
        setAction(null)
        return
      }
      onPersistentHighlightCreated?.(createPersistentMarkdownHighlight(
        sourceFileId,
        sourceHash,
        payload.selection,
        highlightColor,
      ))
      setAction(null)
      setTranslationState({ status: 'idle' })
      window.getSelection()?.removeAllRanges()
      return
    }
    const rangeRect = rangeBounds(range)
    const hostRect = host.getBoundingClientRect()
    setAction({
      payload,
      left: Math.max(8, rangeRect.left - hostRect.left),
      top: Math.max(8, rangeRect.bottom - hostRect.top + 8),
    })
    setTranslationState({ status: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeDraft 는 렌더마다 새로 만들어지지만 workspace·paneId 만 읽는다
  }, [boxHighlights, eraseHighlights, highlightColor, interactionMode, noteApi, onBoxHighlightCreated, onPersistentHighlightCreated, paneId, path, rectsOf, sourceFileId, sourceHash, title, workspace])

  const finishLasso = useCallback((clientX: number, clientY: number) => {
    const root = articleRef.current
    const host = hostRef.current
    const start = lassoStartRef.current
    lassoStartRef.current = null
    setLassoRect(null)
    if (root === null || host === null || start === null) return
    const rect = normalizedRect(start.x, start.y, clientX, clientY)
    if (rect.width < 4 || rect.height < 4) return
    const selected = [...root.children].filter((element) => rectIntersects(rect, element.getBoundingClientRect()))
    const first = selected[0]
    const last = selected.at(-1)
    if (first === undefined || last === undefined) return
    const range = document.createRange()
    range.setStartBefore(first)
    range.setEndAfter(last)
    // PDF 처럼 영역 메모: 끈 네모(종이 좌표)와 그 자리 블록들의 모습을 남긴다
    if (onBoxHighlightCreated !== undefined) {
      const offsets = rangeOffsets(root, range)
      const box = root.getBoundingClientRect()
      const paper = markdownPaperOf(root, zoom)
      const toPaperX = (clientX: number) => (clientX - box.left - paper.left) / paper.scale
      const toPaperY = (clientY: number) => (clientY - box.top + root.scrollTop) / paper.scale
      if (offsets !== null) {
        const html = selected.map((element) => element.outerHTML).join('')
        const anchor = {
          docId: path,
          page: 0,
          coordSpace: 'pdfium-page' as const,
          rects: [{ x: toPaperX(rect.left), y: toPaperY(rect.top), w: rect.width / paper.scale, h: rect.height / paper.scale }],
          charRange: [offsets.startOffset, offsets.endOffset] as const,
          quote: range.toString().replace(/\s+/gu, ' ').trim().slice(0, 2000),
          prefix: '',
          suffix: '',
        }
        routeDraft(createPersistentPdfHighlight(anchor, defaultHighlightColorId(getHighlightColors()), {
          kind: 'region',
          // 글 칸의 자리·폭도 잰다(종이 안 글 칸 위치는 배율·창 폭에 따라 다르다)
          snapshot: html.length <= REGION_SNAPSHOT_LIMIT ? {
            html,
            top: toPaperY(first.getBoundingClientRect().top),
            left: toPaperX(first.getBoundingClientRect().left),
            width: first.getBoundingClientRect().width / paper.scale,
          } : undefined,
          createdAt: new Date().toISOString(),
          source: 'iwae',
        }))
        return
      }
    }
    const payload = selectionPayload(root, path, sourceFileId, title, range, sourceHash, {
      left: rect.left,
      top: rect.top,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    })
    if (payload === null) return
    const hostRect = host.getBoundingClientRect()
    setAction({
      payload,
      left: Math.max(8, rect.left - hostRect.left),
      top: Math.max(8, rect.top + rect.height - hostRect.top + 8),
    })
    setTranslationState({ status: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeDraft 는 렌더마다 새로 만들어지지만 workspace·paneId 만 읽는다
  }, [onBoxHighlightCreated, paneId, path, sourceFileId, sourceHash, title, workspace, zoom])

  // 번역기의 「선택한 글 넣기」가 읽을 수 있게 고른 글을 알린다
  const readerSelectionId = useId()
  const selectedQuote = action?.payload.selection.quote ?? ''
  useEffect(() => {
    publishReaderSelection(readerSelectionId, selectedQuote)
    return () => publishReaderSelection(readerSelectionId, '')
  }, [readerSelectionId, selectedQuote])

  const translationRequest = useRef(0)
  const { override, sourceOverride } = useEffectiveTargetLanguage(action?.payload.selection.quote ?? '')
  const translateSelection = useCallback(async (force = false, supersede = false) => {
    if (action === null || onTranslateSelection === undefined || (translationState.status === 'pending' && !supersede)) return
    const current = translationRequest.current + 1
    translationRequest.current = current
    setTranslationState({ status: 'pending' })
    try {
      const quote = action.payload.selection.quote
      const source = force || supersede ? sourceOverride : sourceForNewText(quote, sourceOverride)
      const options = { ...(force ? { force: true } : {}), ...(override === undefined ? {} : { targetLanguage: override }), ...(source === undefined ? {} : { sourceLanguage: source }) }
      const translation = await (Object.keys(options).length > 0 ? onTranslateSelection(quote, options) : onTranslateSelection(quote))
      if (translationRequest.current !== current) return
      setTranslationState(translation === null
        ? { status: 'error', message: t('번역 결과를 받지 못했습니다.') }
        : { status: 'result', translation })
    } catch (error) {
      if (translationRequest.current !== current) return
      setTranslationState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [action, onTranslateSelection, translationState.status, override, sourceOverride])
  const closeTranslationCard = useCallback(() => {
    translationRequest.current += 1
    setTranslationState({ status: 'idle' })
  }, [])

  // 마우스 제스처 ↑↓(App): 이 글의 맨 위·아래로
  useEffect(() => {
    const onEdge = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; edge?: 'top' | 'bottom' }>).detail
      const article = articleRef.current
      if (detail?.path !== path || article === null) return
      article.scrollTo({ top: detail.edge === 'bottom' ? article.scrollHeight : 0, behavior: 'smooth' })
    }
    window.addEventListener('iwae:md-edge', onEdge)
    return () => window.removeEventListener('iwae:md-edge', onEdge)
  }, [path])

  useEffect(() => {
    if (interactionMode !== 'lasso') {
      lassoStartRef.current = null
      setLassoRect(null)
      return
    }
    const move = (event: PointerEvent) => {
      const start = lassoStartRef.current
      if (start === null) return
      setLassoRect(normalizedRect(start.x, start.y, event.clientX, event.clientY))
    }
    const finish = (event: PointerEvent) => finishLasso(event.clientX, event.clientY)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [finishLasso, interactionMode])

  useLayoutEffect(() => {
    const root = articleRef.current
    const host = hostRef.current
    if (root === null || host === null) return
    const hostRect = host.getBoundingClientRect()
    const next: SourceMarker[] = []
    for (const reference of sourceHighlights) {
      if (reference.relation !== 'markdown-excerpt' || reference.selection.path !== path) continue
      const range = rangeFromOffsets(root, reference.selection.startOffset, reference.selection.endOffset)
      if (range === null) continue
      const rects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []
      const measured = rects.length === 0 ? [rangeBounds(range)] : rects
      for (const rect of measured) {
        next.push({
          blockId: reference.blockId,
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        })
      }
    }
    setMarkers(next)
  }, [layoutRevision, path, search.html, sourceHighlights])

  useEffect(() => {
    const root = articleRef.current
    if (root === null || jumpRequest === null || jumpRequest.path !== path) return
    const range = rangeFromOffsets(root, jumpRequest.startOffset, jumpRequest.endOffset)
    if (range === null) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' })
    onJumpHandled?.()
  }, [jumpRequest, onJumpHandled, path])

  // ---------- 검색(왼쪽 바 목록): 칠한 자리를 모아 알리고, 고른 자리로 간다 ----------
  useLayoutEffect(() => {
    const article = articleRef.current
    if (article === null || onSearchHits === undefined || !primary) return
    const marks = [...article.querySelectorAll<HTMLElement>('mark.markdown-search-hit')]
    const hits = marks.map((mark, index) => {
      const block = mark.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote') ?? mark.parentElement
      const text = block?.textContent ?? mark.textContent ?? ''
      const before = (() => {
        const range = document.createRange()
        if (block === null) return ''
        range.selectNodeContents(block)
        range.setEndBefore(mark)
        return range.toString()
      })()
      const quote = mark.textContent ?? ''
      return { index, before: before.slice(-40).replace(/\s+/gu, ' '), quote, after: text.slice(before.length + quote.length, before.length + quote.length + 40).replace(/\s+/gu, ' ') }
    })
    // 지금 보는 자리부터: 화면 위쪽 이후의 첫 자리, 없으면 처음(끝까지 가면 앞으로)
    const top = article.getBoundingClientRect().top
    const startIndex = marks.findIndex((mark) => mark.getBoundingClientRect().top >= top)
    onSearchHits(hits, hits.length === 0 ? -1 : startIndex < 0 ? 0 : startIndex)
    // 그린 HTML 이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.html])
  useEffect(() => {
    const article = articleRef.current
    if (article === null || searchJump === null) return
    const marks = article.querySelectorAll<HTMLElement>('mark.markdown-search-hit')
    marks.forEach((mark, index) => mark.classList.toggle('markdown-search-hit-active', index === searchJump.index))
    marks[searchJump.index]?.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchJump?.nonce])

  // ---------- PDF 와 같은 읽기 틀: 스크롤바(제목 눈금), 절 이동, 배율, 읽던 자리 ----------
  const [scrollBox, setScrollBox] = useState({ top: 0, height: 1, client: 1 })
  const [headings, setHeadings] = useState<readonly { readonly top: number; readonly depth: number; readonly title: string }[]>([])
  const measureScroll = useCallback(() => {
    const article = articleRef.current
    if (article === null) return
    setScrollBox((current) => (current.top === article.scrollTop && current.height === article.scrollHeight && current.client === article.clientHeight
      ? current
      : { top: article.scrollTop, height: article.scrollHeight, client: article.clientHeight }))
  }, [])
  // 제목 자리(문서 안 높이): 그린 HTML·배율이 바뀔 때마다 잰다
  useLayoutEffect(() => {
    const article = articleRef.current
    if (article === null) return
    const base = article.getBoundingClientRect().top - article.scrollTop
    setHeadings([...article.querySelectorAll<HTMLElement>('h1, h2, h3')].map((element) => ({
      top: element.getBoundingClientRect().top - base,
      depth: Number(element.tagName.slice(1)),
      title: element.textContent?.trim() ?? '',
    })))
    measureScroll()
  }, [search.html, zoom, measureScroll])
  const currentSection = useMemo(() => {
    let index = 0
    for (let i = 0; i < headings.length; i += 1) if (headings[i]!.top <= scrollBox.top + 48) index = i
    return index
  }, [headings, scrollBox.top])
  useEffect(() => {
    if (!primary) return
    onSectionsChange?.(headings.length === 0 ? 0 : currentSection, Math.max(headings.length, 1))
  }, [currentSection, headings.length, onSectionsChange])
  useEffect(() => {
    if (sectionRequest === null) return
    const target = headings[sectionRequest.index]
    if (target !== undefined) articleRef.current?.scrollTo({ top: Math.max(target.top - 16, 0) })
    // 요청(nonce)이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRequest?.nonce])
  // 읽던 자리: 문서마다 스크롤 비율을 기억했다가 다시 열면 그 자리로
  const positionKey = `iwae:md-position:v1`
  const restoredRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const article = articleRef.current
    if (article === null || restoredRef.current === path || !primary) return
    restoredRef.current = path
    try {
      const saved = (JSON.parse(window.localStorage.getItem(positionKey) ?? '{}') as Record<string, number>)[path]
      if (typeof saved === 'number' && saved > 0) article.scrollTop = saved * Math.max(article.scrollHeight - article.clientHeight, 0)
    } catch { /* 처음부터 */ }
  }, [path, search.html])
  const savePositionRef = useRef<number | null>(null)
  const savePosition = () => {
    if (!primary) return
    if (savePositionRef.current !== null) window.clearTimeout(savePositionRef.current)
    savePositionRef.current = window.setTimeout(() => {
      const article = articleRef.current
      if (article === null) return
      const ratio = article.scrollTop / Math.max(article.scrollHeight - article.clientHeight, 1)
      try {
        const all = JSON.parse(window.localStorage.getItem(positionKey) ?? '{}') as Record<string, number>
        all[path] = Math.round(ratio * 10000) / 10000
        window.localStorage.setItem(positionKey, JSON.stringify(all))
      } catch { /* 이번 실행에만 */ }
    }, 400)
  }
  // 스크롤바 끌기·누르기(PDF 와 같은 막대)
  const scrollbarRef = useRef<HTMLDivElement | null>(null)
  const scrollToTrack = (clientY: number, grabOffset: number) => {
    const track = scrollbarRef.current?.getBoundingClientRect()
    const article = articleRef.current
    if (track === undefined || article === null || track.height <= 0) return
    const thumb = Math.max((article.clientHeight / article.scrollHeight) * track.height, 28)
    const ratio = (clientY - track.top - grabOffset) / Math.max(track.height - thumb, 1)
    article.scrollTop = Math.min(Math.max(ratio, 0), 1) * (article.scrollHeight - article.clientHeight)
  }
  const trackHeight = scrollbarRef.current?.clientHeight ?? scrollBox.client
  const thumbHeight = Math.max((scrollBox.client / Math.max(scrollBox.height, 1)) * trackHeight, 28)
  const thumbTop = (scrollBox.top / Math.max(scrollBox.height - scrollBox.client, 1)) * (trackHeight - thumbHeight)

  // 목차 눈금·제목(PDF 와 같은 규칙): 제목 1~3단계, 같은 자리는 하나만, 제목 글자는 큰 단계부터 겹치지 않게
  const scrollbarMarks = useMemo(() => {
    const seen = new Set<number>()
    return headings.flatMap((heading, index) => {
      if (heading.depth > 3) return []
      const y = Math.round((heading.top / Math.max(scrollBox.height, 1)) * trackHeight)
      if (seen.has(y) || seen.has(y - 1) || seen.has(y + 1)) return []
      seen.add(y)
      return [{ heading: { ...heading, level: heading.depth - 1 }, y, index }]
    })
  }, [headings, scrollBox.height, trackHeight])
  const scrollbarLabels = useMemo(() => {
    const placed: typeof scrollbarMarks = []
    for (const mark of [...scrollbarMarks].sort((a, b) => a.heading.level - b.heading.level || a.index - b.index)) {
      if (placed.some((other) => Math.abs(other.y - mark.y) < 19)) continue
      placed.push(mark)
    }
    return placed.sort((a, b) => a.y - b.y)
  }, [scrollbarMarks])
  const currentHeadingIndex = (() => {
    let found = -1
    for (const mark of scrollbarMarks) if (mark.heading.top <= scrollBox.top + 24) found = mark.index
    return found
  })()

  // 책갈피 핀: 막대 위 높이 = 문서 안 비율 × 막대 높이. 막대에 마우스를 올리면 흐린 새 핀이 따라온다
  const [ghostY, setGhostY] = useState<number | null>(null)
  const [editingPinId, setEditingPinId] = useState<string | null>(null)
  const placedPins = useMemo<readonly PlacedPin[]>(() => pins.map((pin) => ({
    pin,
    y: Math.round((pin.y ?? 0) * trackHeight),
    target: Math.max((pin.y ?? 0) * scrollBox.height - 6, 0),
  })), [pins, scrollBox.height, trackHeight])
  const pinPress = useRef(createPinPressTracker())
  const pinRatioAt = (barY: number) => Math.min(Math.max(barY / Math.max(trackHeight, 1), 0), 1)
  const plantPin = () => {
    if (onAddPin === undefined || ghostY === null) return
    const ratio = pinRatioAt(ghostY)
    // 기본 이름: 그 자리가 속한 제목
    const docY = ratio * scrollBox.height
    const heading = [...headings].reverse().find((item) => item.top <= docY + 8)
    const id = onAddPin(0, ratio, heading?.title ?? title)
    setGhostY(null)
    setEditingPinId(id)
  }

  return (
    <div
      ref={hostRef}
      className={`markdown-pane-host${clean ? ' pdf-clean-view' : ''}`}
      data-markdown-pane={path}
      data-markdown-theme={theme}
      data-reader-mode={interactionMode}
      onPointerDown={(event) => {
        if (interactionMode === 'hand' && event.button === 0 && articleRef.current !== null) {
          // 손 도구: 잡고 끌어 화면을 옮긴다(PDF 와 같다)
          const article = articleRef.current
          const startY = event.clientY
          const startTop = article.scrollTop
          event.preventDefault()
          const move = (moveEvent: PointerEvent) => { article.scrollTop = startTop - (moveEvent.clientY - startY) }
          const end = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
            window.removeEventListener('pointercancel', end)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end)
          window.addEventListener('pointercancel', end)
          return
        }
        if (interactionMode !== 'lasso' || event.button !== 0) return
        event.preventDefault()
        setAction(null)
        setTranslationState({ status: 'idle' })
        window.getSelection()?.removeAllRanges()
        lassoStartRef.current = { x: event.clientX, y: event.clientY }
        setLassoRect({ left: event.clientX, top: event.clientY, width: 0, height: 0 })
      }}
      onPointerMove={(event) => {
        // 메뉴 항목을 막 고른 자리면 호버를 비켜 간다(포인터가 진짜 움직이면 다음 move 부터 보통대로)
        if (menuGuardActive() || memoHoverFrame.current !== null || (event.buttons & 1) !== 0) return
        const { clientX, clientY } = event
        memoHoverFrame.current = requestAnimationFrame(() => {
          memoHoverFrame.current = null
          const hit = memoAtPoint(clientX, clientY)
          const id = hit !== null && noteApi !== null && noteApi.notesOf(hit.id).length > 0 ? hit.id : null
          if (id === memoHoverId.current) return
          memoHoverId.current = id
          reportMemoHover(id)
        })
      }}
      onPointerLeave={() => {
        cancelMemoHoverFrame()
        if (memoHoverId.current === null) return
        memoHoverId.current = null
        reportMemoHover(null)
      }}
      onContextMenu={(event) => {
        // 마우스 제스처를 그렸으면 제스처가 이 메뉴 이벤트를 먼저 막는다. 여기 오는 것은 그냥 우클릭
        event.preventDefault()
        setDocMenu({ x: event.clientX, y: event.clientY, text: window.getSelection()?.toString() ?? '' })
      }}
      onClick={(event) => {
        // 링크: 바깥 주소는 확인 뒤 브라우저로, #제목은 이 문서 안에서, 다른 .md 는 IWAE 탭으로 연다
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
        if (link !== null && articleRef.current?.contains(link)) {
          event.preventDefault()
          const resolved = resolveMarkdownLink(link.getAttribute('href') ?? '', path.replaceAll('\\', '/'))
          if (resolved?.kind === 'external') onExternalLink?.(resolved.url)
          else if (resolved?.kind === 'anchor') {
            const heading = articleRef.current.querySelector(`[id="${CSS.escape(resolved.id)}"]`)
            heading?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          } else if (resolved?.kind === 'document') {
            if (isMarkdownPath(resolved.path)) onOpenDocument?.(resolved.path, resolved.anchor)
          }
          return
        }
        // 메모가 달린 자리를 누르면 같은 색 창(노트 탭·같은 문서를 연 다른 창)이 그 메모로 간다
        const memoHit = memoAtPoint(event.clientX, event.clientY)
        if (memoHit !== null && noteApi !== null && noteApi.notesOf(memoHit.id).length > 0) revealMemo(memoHit.id)
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-markdown-highlight-id]')
          : null
        if (target === null || onPersistentHighlightRemoved === undefined) {
          setHighlightAction(null)
          return
        }
        // 형광펜 지우개: 누른 형광펜을 바로 지운다(PDF 와 같다)
        if (interactionMode === 'highlight' && eraseHighlights) {
          onPersistentHighlightRemoved(target.dataset.markdownHighlightId ?? '')
          setHighlightAction(null)
          announceAction(t('형광펜 표시를 지웠습니다'))
          return
        }
        const host = hostRef.current
        if (host === null) return
        const rect = target.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        setHighlightAction({
          id: target.dataset.markdownHighlightId ?? '',
          left: Math.max(8, rect.left - hostRect.left),
          top: Math.max(8, rect.bottom - hostRect.top + 6),
        })
      }}
      style={{
        '--md-background': markdownTheme.tokens.background,
        '--md-foreground': markdownTheme.tokens.foreground,
        '--md-muted': markdownTheme.tokens.muted,
        '--md-border': markdownTheme.tokens.border,
        '--md-link': markdownTheme.tokens.link,
        '--md-code-background': markdownTheme.tokens.codeBackground,
        '--md-quote-border': markdownTheme.tokens.quoteBorder,
        '--md-max-width': markdownTheme.tokens.maxWidth,
        '--md-zoom': String(zoom / 100),
      } as CSSProperties}
      onWheel={(event) => {
        // Ctrl+휠: 배율(PDF 와 같다)
        if (!event.ctrlKey || onZoomChange === undefined) return
        event.preventDefault()
        onZoomChange(Math.min(Math.max(Math.round(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)), 50), 300))
      }}
    >
      <article
        ref={articleRef}
        className="markdown-pane"
        aria-label={title}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        onScroll={() => {
          setLayoutRevision((value) => value + 1)
          measureScroll()
          savePosition()
        }}
        onDragStart={(event) => {
          if (action !== null) putDragPayload(event, action.payload)
        }}
        dangerouslySetInnerHTML={{ __html: search.html }}
      />
      <MarkdownWriteLayer
        path={path}
        articleRef={articleRef}
        scrollTop={scrollBox.top}
        scrollHeight={scrollBox.height}
        zoom={zoom}
        layoutKey={articleLayoutKey}
        mode={interactionMode}
        rectsOf={rectsOf}
        boxRequest={boxRequest}
        highlights={boxHighlights}
        onHighlightCreated={onBoxHighlightCreated}
        onHighlightUpdated={onBoxHighlightUpdated}
        onHighlightRemoved={onBoxHighlightRemoved}
        overlays={overlays}
        onOverlayAdd={onOverlayAdd}
        onOverlayUpdate={onOverlayUpdate}
        onOverlayRemove={onOverlayRemove}
        onModeChange={(mode) => onInteractionModeChange?.(mode)}
        draftMemo={draftMemo}
      />
      {scrollBox.height > scrollBox.client + 1 ? (
        <div
          ref={scrollbarRef}
          className="pdf-scrollbar markdown-scrollbar"
          aria-hidden="true"
          onPointerMove={(event) => {
            if (onAddPin === undefined || !primary) return
            const rect = event.currentTarget.getBoundingClientRect()
            setGhostY(Math.round(Math.min(Math.max(event.clientY - rect.top, 0), rect.height)))
          }}
          onPointerLeave={() => setGhostY(null)}
          onWheel={(event) => { if (!event.ctrlKey && articleRef.current !== null) articleRef.current.scrollTop += event.deltaY }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            const onThumb = (event.target as Element).closest('.markdown-scrollbar-thumb') !== null
            const thumbRect = (event.currentTarget.querySelector('.markdown-scrollbar-thumb') as HTMLElement | null)?.getBoundingClientRect()
            const grab = onThumb && thumbRect !== undefined ? event.clientY - thumbRect.top : thumbHeight / 2
            event.currentTarget.setPointerCapture?.(event.pointerId)
            scrollToTrack(event.clientY, grab)
            const move = (moveEvent: PointerEvent) => scrollToTrack(moveEvent.clientY, grab)
            const end = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', end)
              window.removeEventListener('pointercancel', end)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', end)
            window.addEventListener('pointercancel', end)
          }}
        >
          {ghostY !== null && onAddPin !== undefined ? (
            <button
              type="button"
              tabIndex={-1}
              className="pdf-pin-ghost"
              style={{ top: `${ghostY}px` }}
              title={t('두 번 눌러 책갈피 핀 꽂기')}
              aria-label={t('여기에 책갈피 핀 꽂기')}
              onPointerDown={(event) => {
                event.stopPropagation()
                if (event.button !== 0) return
                event.preventDefault()
                // 두 번 눌러야 꽂는다(한 번은 막대 옆 빈 자리를 누르려던 손일 수 있다)
                if (pinPress.current.press(performance.now())) plantPin()
              }}
            >
              <PinHead />
            </button>
          ) : null}
          <span className="markdown-scrollbar-thumb" style={{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }} />
          {scrollbarMarks.map(({ heading, y, index }) => (
            <i
              key={`${index}:${heading.title}`}
              className={`pdf-scrollbar-mark pdf-scrollbar-mark-${heading.level}`}
              style={{ top: `${y}px` }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                articleRef.current?.scrollTo({ top: Math.max(heading.top - 16, 0) })
              }}
            />
          ))}
          {scrollbarLabels.length > 0 ? (
            // 제목 칸: PDF 와 같다(막대에 마우스를 올리면 겹치지 않는 제목이 펼쳐진다)
            <div className="pdf-scrollbar-labels">
              {scrollbarLabels.map(({ heading, y, index }) => (
                <button
                  key={`${index}:${heading.title}`}
                  type="button"
                  tabIndex={-1}
                  className={[
                    'pdf-scrollbar-label',
                    `pdf-scrollbar-label-${heading.level}`,
                    index === currentHeadingIndex ? 'pdf-scrollbar-label-current' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ top: `${y}px` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    articleRef.current?.scrollTo({ top: Math.max(heading.top - 16, 0) })
                  }}
                >
                  <span className="pdf-scrollbar-label-title">{heading.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {primary && placedPins.length > 0 ? (
        <PdfPins
          pins={placedPins}
          editingId={editingPinId}
          onEdit={setEditingPinId}
          onJump={(target) => articleRef.current?.scrollTo({ top: target })}
          onUpdate={onUpdatePin}
          track={{ top: 0, bottom: trackHeight }}
          onMove={onMovePin === undefined ? undefined : (id, barY) => onMovePin(id, 0, pinRatioAt(barY))}
          onRemove={onRemovePin}
        />
      ) : null}
      {searchQuery.trim() === '' ? null : (
        <output className="markdown-search-count" aria-label={t('Markdown 검색 결과')}>
          {t('{count}개 결과', { count: search.count })}
        </output>
      )}
      <div className="markdown-source-layer" aria-hidden="true">
        {markers.map((marker, index) => (
          <span
            key={`${marker.blockId}-${index}`}
            data-markdown-source-target={marker.blockId}
            style={{
              left: `${marker.left}px`,
              top: `${marker.top}px`,
              width: `${marker.width}px`,
              height: `${marker.height}px`,
            }}
          />
        ))}
      </div>
      {docMenu === null ? null : (
        <ContextMenu
          x={docMenu.x}
          y={docMenu.y}
          label={t('문서 메뉴')}
          onClose={() => setDocMenu(null)}
          entries={documentContextEntries({ selectedText: docMenu.text })}
        />
      )}
      {lassoRect === null ? null : (
        <span
          className="markdown-lasso-rect"
          aria-hidden="true"
          style={{
            left: `${lassoRect.left - (hostRef.current?.getBoundingClientRect().left ?? 0)}px`,
            top: `${lassoRect.top - (hostRef.current?.getBoundingClientRect().top ?? 0)}px`,
            width: `${lassoRect.width}px`,
            height: `${lassoRect.height}px`,
          }}
        />
      )}
      {highlightAction === null ? null : (
        <button
          type="button"
          className="markdown-highlight-delete"
          aria-label={t('형광펜 삭제')}
          style={{ left: `${highlightAction.left}px`, top: `${highlightAction.top}px` }}
          onClick={(event) => {
            event.stopPropagation()
            onPersistentHighlightRemoved?.(highlightAction.id)
            setHighlightAction(null)
          }}
        >
          {t('형광펜 삭제')}
        </button>
      )}
      {action === null ? null : (
        <div
          className="markdown-selection-stack"
          style={{ left: `${action.left}px`, top: `${action.top}px` } as CSSProperties}
        >
          <div className="selection-actions markdown-selection-actions" role="toolbar" aria-label={t('Markdown 선택 작업')}>
            {/* PDF 와 같은 차례: 복사 · 출처 복사 · 문서 검색 · 노트로 · 번역 */}
            <button
              type="button"
              className="selection-action"
              disabled={action.payload.selection.quote.trim() === ''}
              onClick={() => {
                void navigator.clipboard?.writeText(action.payload.selection.quote)
                announceAction(t('복사했습니다'))
              }}
            >
              {t('복사')}
            </button>
            <button
              type="button"
              className="selection-action"
              disabled={action.payload.selection.quote.trim() === ''}
              title={t('출처와 함께 복사')}
              onClick={() => {
                const root = articleRef.current
                const selection = window.getSelection()
                const heading = root === null || selection === null || selection.rangeCount === 0 ? null : headingBefore(root, selection.getRangeAt(0).startContainer)
                const where = [title, heading === null ? null : `§${heading}`].filter(Boolean).join(', ')
                const text = `"${action.payload.selection.quote.replace(/\s+/gu, ' ').trim()}" — [${where}]`
                void navigator.clipboard?.writeText(text).then(
                  () => announceAction(t('출처와 함께 복사했습니다')),
                  (cause: unknown) => announceAction(t('복사하지 못했습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) })),
                )
              }}
            >
              {t('출처 복사')}
            </button>
            {onSearchDocuments === undefined ? null : (
              <button
                type="button"
                className="selection-action"
                disabled={action.payload.selection.quote.trim() === ''}
                title={t('고른 글자로 문서 검색 (Ctrl+Shift+F)')}
                onClick={() => onSearchDocuments(action.payload.selection.quote)}
              >
                {t('문서 검색')}
              </button>
            )}
            <button
              type="button"
              className="selection-action"
              aria-label={t('선택 내용을 노트로 드래그')}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                startInternalDrag(event, {
                  [MARKDOWN_EXCERPT_DRAG_MIME]: serializeMarkdownExcerptDrag(action.payload),
                  'text/plain': action.payload.selection.quote,
                }, { label: action.payload.selection.quote.slice(0, 60) || t('노트로 끌기') })
              }}
            >
              {t('노트로 드래그')}
            </button>
            {onTranslateSelection === undefined ? null : (
              <button
                type="button"
                className="selection-action"
                aria-label={t('번역')}
                disabled={translationState.status === 'pending'}
                onClick={() => void translateSelection()}
              >
                {translationState.status === 'pending' ? t('번역 중…') : t('번역')}
              </button>
            )}
          </div>
          {translationState.status === 'idle' ? null : (
            <TranslationCard
              original={action.payload.selection.quote}
              state={translationState}
              ariaLabel={t('Markdown 번역 결과')}
              onClose={closeTranslationCard}
              onRetry={() => void translateSelection(true)}
              onRetranslateAfterLanguageChange={() => void translateSelection(true, true)}
              {...(onSendTranslatedSelection === undefined ? {} : { onSendToNote: () => {
                if (translationState.status === 'result') onSendTranslatedSelection(action.payload, translationState.translation)
              } })}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** 고른 자리 바로 앞(같거나 위)의 제목 글(h1~h6). 「출처 복사」에 § 로 붙인다 */
function headingBefore(root: HTMLElement, node: Node): string | null {
  let block: Node | null = node
  while (block !== null && block.parentNode !== root) block = block.parentNode
  for (let current: Element | null = block instanceof Element ? block : null; current !== null; current = current.previousElementSibling) {
    if (/^H[1-6]$/u.test(current.tagName)) return current.textContent?.trim() || null
  }
  return null
}
