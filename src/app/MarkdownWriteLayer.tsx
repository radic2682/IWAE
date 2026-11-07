import { t } from '../i18n'
import { coalesceHighlightRects } from '../core/anchor'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useOverlayTool } from '../pdf/overlayToolStore'
import { BOX_DEFAULT_WIDTH, placeBoxMemo, type MemoBox } from '../core/boxMemo'
import type { OverlayPatch, PdfOverlay } from '../core/pdfOverlays'
import { PdfBoxMemos } from '../pdf/PdfBoxMemos'
import { PdfOverlayLayer, type OverlayStyle, type OverlayTool } from '../pdf/PdfOverlayLayer'
import { PdfFloatPalette, PdfOverlayPalette } from '../pdf/PdfOverlayPalette'
import { MemoFormatSlotContext, type MemoContent } from '../pdf/MemoColumn'
import { createPersistentPdfHighlight, updatePersistentPdfHighlight, type PersistentPdfHighlight, type PersistentPdfHighlightPatch } from '../pdf/persistentHighlight'
import '../ui/pdf-box-memo.css'
import '../ui/pdf-overlay.css'

/** Markdown 종이 폭(배율 1). 박스 메모·편집 좌표는 이 종이의 왼쪽 위 기준, 배율 1 의 px 다(PDF 의 쪽 좌표와 같은 뜻) */
export const MARKDOWN_PAPER_WIDTH = 820
/** 종이 양옆 작업 바탕 여백(PDF 쪽 폭 맞춤과 같은 12px) */
export const MARKDOWN_PAPER_GUTTER = 12

/** 폭 맞춤 배율: 종이가 양옆 12px 만 남기고 꽉 차게 */
export function markdownFitWidthZoom(articleWidth: number): number {
  return Math.min(Math.max(((articleWidth - MARKDOWN_PAPER_GUTTER * 2) / MARKDOWN_PAPER_WIDTH) * 100, 50), 300)
}

/** 글자 차례(원문 텍스트 위치)로 화면 사각형을 다시 얻는다(배율·창 폭이 바뀌어도 맞는다) */
export type MarkdownRectsOf = (charRange: readonly [number, number]) => readonly { x: number; y: number; w: number; h: number }[]

/** 박스 메모를 만들 고른 글 */
export interface MarkdownBoxRequest {
  readonly nonce: number
  readonly charRange: readonly [number, number]
  readonly quote: string
}

interface MarkdownWriteLayerProps {
  readonly path: string
  readonly articleRef: RefObject<HTMLElement | null>
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly zoom: number
  /** 글 배치가 바뀔 때마다 바뀌는 값(창 폭·화면 나누기). 형광펜 자리를 다시 잰다 */
  readonly layoutKey?: number
  readonly mode: 'text' | 'lasso' | 'highlight' | 'hand' | 'box' | 'edit'
  readonly rectsOf: MarkdownRectsOf
  readonly boxRequest: MarkdownBoxRequest | null
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly onHighlightCreated?: (highlight: PersistentPdfHighlight) => void
  readonly onHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  readonly onHighlightRemoved?: (id: string) => void
  readonly overlays: readonly PdfOverlay[]
  readonly onOverlayAdd?: (overlay: PdfOverlay) => void
  readonly onOverlayUpdate?: (id: string, patch: OverlayPatch) => void
  readonly onOverlayRemove?: (id: string) => void
  readonly onModeChange?: (mode: 'text') => void
  /** 메모 바에서 쓰는 중인 새 메모(형광펜만 칠한다) */
  readonly draftMemo?: PersistentPdfHighlight | null
}

/** 종이 자리: 글 영역 폭 안에서 가운데, 배율에 따라 커진다(창이 좁으면 창에 맞춘다) */
/** 종이 안 글 칸의 왼쪽 여백(종이 좌표). 글 칸 폭은 820 - 56 × 2 = 708 */
export const MARKDOWN_PAPER_SIDE = 56

/**
 * 글 영역의 「종이」 좌표계: 실제 글 칸(첫 블록)의 자리를 재어, 글 칸 왼쪽이 늘 종이 x = 56 이 되게 맞춘다.
 * 창 폭·배율·화면 나누기에 따라 CSS 가 글 칸을 어디에 두든, 저장한 네모(영역 메모 등)가 같은 글 위에 온다.
 */
export function markdownPaperOf(article: HTMLElement | null, zoom: number): { left: number; width: number; scale: number } {
  const fallback = markdownPaper(article?.clientWidth ?? 0, zoom)
  const first = article?.firstElementChild
  if (article === null || first === null || first === undefined) return fallback
  const scale = zoom / 100
  const left = first.getBoundingClientRect().left - article.getBoundingClientRect().left - MARKDOWN_PAPER_SIDE * scale
  return Number.isFinite(left) ? { left, width: MARKDOWN_PAPER_WIDTH * scale, scale } : fallback
}

export function markdownPaper(articleWidth: number, zoom: number): { left: number; width: number; scale: number } {
  const width = Math.max(Math.min(MARKDOWN_PAPER_WIDTH * (zoom / 100), articleWidth - MARKDOWN_PAPER_GUTTER * 2), 120)
  return { left: (articleWidth - width) / 2, width, scale: width / MARKDOWN_PAPER_WIDTH }
}

/** 영역 네모의 네 귀퉁이 꺾쇠(PDF 영역 메모와 같은 모양) */
function regionCornersPath(x: number, y: number, w: number, h: number): string {
  const n = (value: number) => Math.round(value * 100) / 100
  const r = Math.min(6, w / 2, h / 2)
  const len = Math.max(r + 2, Math.min(18, w / 4, h / 4))
  return [
    `M${n(x)} ${n(y + len)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}H${n(x + len)}`,
    `M${n(x + w - len)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + len)}`,
    `M${n(x + w)} ${n(y + h - len)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + w - len)}`,
    `M${n(x + len)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + h - len)}`,
  ].join('')
}

/** 둥근 네모 여럿을 한 경로로(PDF 형광펜과 같은 2px 둥글기) */
function roundedRectsPath(rects: readonly { x: number; y: number; w: number; h: number }[]): string {
  const n = (value: number) => Math.round(value * 100) / 100
  return rects.map(({ x, y, w, h }) => {
    const r = Math.max(0, Math.min(2, w / 2, h / 2))
    return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`
      + `V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`
      + `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`
      + `V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
  }).join('')
}

/**
 * Markdown 위 쓰기 층: 박스 메모(형광펜 + 선으로 이은 메모 상자)와 편집(글 상자·펜·지우개·선).
 * PDF 와 같은 부품(PdfBoxMemos·PdfOverlayLayer·도구창)을 「쪽 하나짜리 PDF」처럼 얹는다 — 쪽 0, 종이 폭 820.
 * 글 영역과 함께 스크롤된다(위로 그만큼 옮겨 그린다).
 */
export function MarkdownWriteLayer(props: MarkdownWriteLayerProps) {
  const { path, articleRef, scrollTop, scrollHeight, zoom, mode, rectsOf, boxRequest, highlights, overlays } = props
  const articleWidth = articleRef.current?.clientWidth ?? 0
  const paper = markdownPaperOf(articleRef.current, zoom)
  const pageHeight = Math.max(scrollHeight / paper.scale, 1)
  const pageSizes = useMemo(() => [[MARKDOWN_PAPER_WIDTH, pageHeight] as const], [pageHeight])
  const layoutOf = (page: number) => (page === 0 ? { top: 0, left: paper.left, width: paper.width } : undefined)

  // 박스 메모: 이 문서의 것만, 형광펜 사각형은 글자 위치에서 다시 얻는다
  const [draftBox, setDraftBox] = useState<PersistentPdfHighlight | null>(null)
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null)
  const boxMemos = useMemo(() => {
    const own = highlights.filter((item) => item.anchor.docId === path && item.box !== undefined)
    return [...own, ...(draftBox === null ? [] : [draftBox])].map((item) => {
      const rects = rectsOf(item.anchor.charRange)
      return rects.length === 0 ? item : { ...item, anchor: { ...item.anchor, rects } }
    })
    // 스크롤·배율이 바뀌면 사각형도 다시
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, draftBox, path, rectsOf, zoom, articleWidth, props.layoutKey])

  // 노트 메모의 형광펜(박스가 아닌 것): 글자 위치에서 다시 얻는다
  const memoMarks = useMemo(() => [...highlights.filter((item) => item.anchor.docId === path && item.box === undefined && item.kind !== 'region'), ...(props.draftMemo == null ? [] : [props.draftMemo])]
    .map((item) => ({ id: item.id, color: item.color, rects: rectsOf(item.anchor.charRange) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [highlights, props.draftMemo, path, rectsOf, zoom, articleWidth, props.layoutKey])

  // 영역(표·그림) 메모: 끈 네모 그대로(종이 좌표)
  const regionMarks = useMemo(() => [...highlights.filter((item) => item.anchor.docId === path && item.kind === 'region' && item.box === undefined), ...(props.draftMemo?.kind === 'region' ? [props.draftMemo] : [])]
    .flatMap((item) => (item.anchor.rects[0] === undefined ? [] : [{ id: item.id, color: item.color, rect: item.anchor.rects[0] }])),
  [highlights, props.draftMemo, path])

  // 고른 글로 새 박스(여백 자동)
  useEffect(() => {
    if (boxRequest === null) return
    const rects = rectsOf(boxRequest.charRange)
    if (rects.length === 0) return
    const box: MemoBox = placeBoxMemo([MARKDOWN_PAPER_WIDTH, pageHeight], rects, [], BOX_DEFAULT_WIDTH)
    const created = createPersistentPdfHighlight({
      docId: path,
      page: 0,
      coordSpace: 'pdfium-page',
      rects,
      charRange: [boxRequest.charRange[0], boxRequest.charRange[1]],
      quote: boxRequest.quote,
      prefix: '',
      suffix: '',
    }, 'yellow', { createdAt: new Date().toISOString(), source: 'iwae' })
    setDraftBox({ ...created, box })
    setEditingBoxId(created.id)
    // 요청이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRequest?.nonce])

  const saveBox = (id: string, content: MemoContent) => {
    if (draftBox !== null && id === draftBox.id) {
      const draft = draftBox
      setDraftBox(null)
      if (content.text.trim() === '') return
      props.onHighlightCreated?.(updatePersistentPdfHighlight(draft, { note: content.text, noteHtml: content.html }))
      return
    }
    props.onHighlightUpdated?.(id, { note: content.text, noteHtml: content.html })
  }

  // 편집 도구창 상태
  const [overlayTool, setOverlayTool] = useOverlayTool()
  const [overlayStyle, setOverlayStyle] = useState<OverlayStyle>({ color: '#d9363e', textSize: 9, lineWidth: 2, arrow: false, dashed: false })
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null)
  useEffect(() => { if (mode !== 'edit') setSelectedOverlay(null) }, [mode])
  const [boxFormatSlot, setBoxFormatSlot] = useState<HTMLDivElement | null>(null)

  const forwardWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey) return
    const article = articleRef.current
    if (article !== null) article.scrollTop += event.deltaY
  }

  return (
    <>
      {/* 형광펜: 쓰기 층과 따로, 글 바로 위에서 곱하기로 섞는다 — 종이만 물들고 글자는 검은색 그대로(PDF 와 같이 글자 밑으로).
          한 줄의 조각(굵은 글씨 등)은 하나로 이어 칠한다 */}
      <div className="markdown-mark-host" aria-hidden="true">
        <svg className="markdown-box-marks" width={articleWidth} height={scrollHeight} style={{ transform: `translateY(${-scrollTop}px)` }}>
          {[...memoMarks.map((memo) => ({ id: `memo:${memo.id}`, color: memo.color, rects: memo.rects })), ...boxMemos.map((memo) => ({ id: memo.id, color: memo.color, rects: memo.anchor.rects }))]
            .filter((mark) => mark.rects.length > 0)
            .map((mark) => (
              <path
                key={mark.id}
                className="markdown-mark"
                data-highlight-color={mark.color}
                d={roundedRectsPath(coalesceHighlightRects(mark.rects).map((rect) => ({ x: paper.left + rect.x * paper.scale, y: rect.y * paper.scale, w: rect.w * paper.scale, h: rect.h * paper.scale })))}
              />
            ))}
          {regionMarks.map((mark) => {
            const x = paper.left + mark.rect.x * paper.scale - 4
            const y = mark.rect.y * paper.scale - 4
            const w = mark.rect.w * paper.scale + 8
            const h = mark.rect.h * paper.scale + 8
            return (
              <g key={`region:${mark.id}`} data-highlight-color={mark.color} className="markdown-mark-region-group">
                <rect className="markdown-mark-region" x={x} y={y} width={w} height={h} rx={6} />
                <path className="markdown-mark-corners" d={regionCornersPath(x, y, w, h)} />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="markdown-write-host" onWheel={forwardWheel} data-markdown-edit={mode === 'edit' || undefined}>
        <div className="markdown-write-surface" style={{ width: articleWidth, height: scrollHeight, transform: `translateY(${-scrollTop}px)` }}>
          {boxMemos.length > 0 ? (
            <MemoFormatSlotContext.Provider value={boxFormatSlot}>
              <PdfBoxMemos
                memos={boxMemos}
                draftId={draftBox?.id ?? null}
                editingId={editingBoxId}
                pageSizes={pageSizes}
                layoutOf={layoutOf}
                width={articleWidth}
                height={scrollHeight}
                onEdit={setEditingBoxId}
                onSave={saveBox}
                onCancelDraft={() => { setDraftBox(null); setEditingBoxId(null) }}
                onChange={(id, patch) => {
                  if (draftBox !== null && id === draftBox.id) setDraftBox(updatePersistentPdfHighlight(draftBox, patch))
                  else props.onHighlightUpdated?.(id, patch)
                }}
                onDelete={(id) => props.onHighlightRemoved?.(id)}
              />
            </MemoFormatSlotContext.Provider>
          ) : null}
          {(overlays.length > 0 || mode === 'edit') && props.onOverlayAdd !== undefined && props.onOverlayUpdate !== undefined && props.onOverlayRemove !== undefined ? (
            <PdfOverlayLayer
              overlays={overlays}
              pageSizes={pageSizes}
              layoutOf={layoutOf}
              width={articleWidth}
              height={scrollHeight}
              editMode={mode === 'edit'}
              tool={overlayTool}
              style={overlayStyle}
              onAdd={props.onOverlayAdd}
              onUpdate={props.onOverlayUpdate}
              onRemove={props.onOverlayRemove}
              selectedId={selectedOverlay}
              onSelect={setSelectedOverlay}
            />
          ) : null}
        </div>
      </div>
      {mode === 'edit' ? (
        <PdfOverlayPalette
          tool={overlayTool}
          style={overlayStyle}
          onToolChange={(next) => { setOverlayTool(next); setSelectedOverlay(null) }}
          onStyleChange={(patch) => setOverlayStyle((current) => ({ ...current, ...patch }))}
          selected={overlays.find((item) => item.id === selectedOverlay) ?? null}
          onUpdateSelected={(patch) => { if (selectedOverlay !== null) props.onOverlayUpdate?.(selectedOverlay, patch) }}
          onRemoveSelected={() => {
            if (selectedOverlay === null) return
            props.onOverlayRemove?.(selectedOverlay)
            setSelectedOverlay(null)
          }}
          onDone={() => props.onModeChange?.('text')}
        />
      ) : null}
      {mode === 'box' || editingBoxId !== null || draftBox !== null ? (
        <PdfFloatPalette
          label={t('박스 메모')}
          onDone={() => {
            const active = document.activeElement
            if (active instanceof HTMLElement && active.closest('.pdf-box-card') !== null) active.blur()
            props.onModeChange?.('text')
          }}
        >
          <span className="pdf-box-palette-label">{t('박스 메모')}</span>
          <span className="pdf-overlay-palette-sep" aria-hidden="true" />
          <div className="pdf-box-format-slot" ref={setBoxFormatSlot} />
          {editingBoxId === null && draftBox === null ? <span className="pdf-box-palette-hint">{t('글을 끌면 박스가 생깁니다')}</span> : null}
        </PdfFloatPalette>
      ) : null}
    </>
  )
}
