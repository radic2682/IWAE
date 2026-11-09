import type { Anchor } from '../core/anchor'
import { parseMemoBox, type MemoBox } from '../core/boxMemo'
import { t } from '../i18n'

export type PdfHighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

/** 주제 이름 길이 상한 */
export const MEMO_TOPIC_LIMIT = 40

export interface PersistentPdfHighlight {
  readonly id: string
  readonly anchor: Anchor
  readonly color: PdfHighlightColor
  /** 형광펜에 단 메모. 비어 있으면 필드 자체가 없다 */
  readonly note?: string
  /** 메모의 서식(굵게·색·목록 등)을 담은 HTML. 글만 있으면 없다. note 는 늘 같은 내용의 글이다 */
  readonly noteHtml?: string
  /** 만든 시각(ISO). 예전 항목에는 없다 */
  readonly createdAt?: string
  /** 다른 프로그램의 PDF 주석에서 가져온 것인가 */
  readonly source?: 'iwae' | 'imported'
  /** 메모를 모아 볼 카테고리(예: TODO). PDF 마다 쓰는 카테고리가 따로 모인다 */
  readonly topic?: string
  /** 'region' 이면 글자가 아니라 네모로 고른 표·그림(anchor.rects 의 첫 네모가 그 영역) */
  readonly kind?: 'region'
  /** 영역 메모의 그 쪽 크기(pt). 다른 PDF 에서 모아 볼 때 원문을 잘라 그리는 데 쓴다 */
  readonly pageSize?: readonly [number, number]
  /** 메모 카드를 접어 두었나(머리줄과 첫 줄만 보인다) */
  readonly collapsed?: true
  /** 별점 1~5 */
  readonly rating?: number
  /** 메모 목록에서 사용자가 끌어 정한 순서. 없으면 문서 순서 */
  readonly order?: number
  /** 있으면 박스 메모: 메모 바·노트가 아니라 PDF 쪽 위의 박스(선으로 이어짐)로 보인다. 쪽 좌표(points) */
  readonly box?: MemoBox
  /** Markdown 영역 메모: 잡을 때의 그 자리 블록들(HTML)과 첫 블록의 위 끝(종이 좌표). 노트에서 이것을 잘라 보인다 */
  readonly snapshot?: RegionSnapshot
}

/** Markdown 영역 메모의 모습: 겹친 블록들의 HTML, 첫 블록 위 끝의 종이 y */
export interface RegionSnapshot {
  readonly html: string
  readonly top: number
  /** 글 칸의 왼쪽 끝과 폭(종이 좌표). 없으면 종이 양옆 56 */
  readonly left?: number
  readonly width?: number
}

/** 영역 모습 HTML 상한(글자 수). 큰 표 몇 개 정도 */
export const REGION_SNAPSHOT_LIMIT = 200_000

function parseSnapshot(value: unknown): RegionSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { html, top, left, width } = value as { html?: unknown; top?: unknown; left?: unknown; width?: unknown }
  if (typeof html !== 'string' || html === '' || html.length > REGION_SNAPSHOT_LIMIT || typeof top !== 'number' || !Number.isFinite(top)) return undefined
  const column = typeof left === 'number' && Number.isFinite(left) && typeof width === 'number' && Number.isFinite(width) && width > 0 ? { left, width } : {}
  return { html, top, ...column }
}

/** 메모 길이 상한. 형광펜 메모는 짧은 생각이고, 긴 글은 노트 캔버스의 몫이다 */
export const HIGHLIGHT_NOTE_LIMIT = 4000

export interface HighlightExtras {
  readonly note?: string
  readonly noteHtml?: string
  readonly createdAt?: string
  readonly source?: 'iwae' | 'imported'
  readonly topic?: string
  readonly kind?: 'region'
  readonly pageSize?: readonly [number, number]
  readonly collapsed?: boolean
  readonly rating?: number
  readonly order?: number
  readonly box?: MemoBox
  readonly snapshot?: RegionSnapshot
}

function normalizedRating(rating: number | undefined): number | undefined {
  if (rating === undefined || !Number.isFinite(rating)) return undefined
  const value = Math.round(rating)
  return value >= 1 && value <= 5 ? value : undefined
}

function normalizedTopic(topic: string | undefined): string | undefined {
  if (topic === undefined) return undefined
  const trimmed = topic.trim().replace(/^#/u, '').trim()
  return trimmed === '' ? undefined : trimmed.slice(0, MEMO_TOPIC_LIMIT)
}

function normalizedNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const trimmed = note.trim()
  return trimmed === '' ? undefined : note.slice(0, HIGHLIGHT_NOTE_LIMIT)
}

function withExtras(base: PersistentPdfHighlight, extras: HighlightExtras): PersistentPdfHighlight {
  const note = normalizedNote(extras.note)
  const topic = normalizedTopic(extras.topic)
  const noteHtml = note === undefined || extras.noteHtml === undefined || extras.noteHtml.trim() === ''
    ? undefined
    : extras.noteHtml.slice(0, HIGHLIGHT_NOTE_LIMIT * 4)
  return {
    ...base,
    ...(noteHtml === undefined ? {} : { noteHtml }),
    ...(extras.kind === 'region' ? { kind: 'region' as const } : {}),
    ...(extras.kind === 'region' && extras.pageSize !== undefined && extras.pageSize.every((n) => Number.isFinite(n) && n > 0)
      ? { pageSize: [extras.pageSize[0], extras.pageSize[1]] as const }
      : {}),
    ...(note === undefined ? {} : { note }),
    ...(topic === undefined ? {} : { topic }),
    ...(extras.createdAt === undefined ? {} : { createdAt: extras.createdAt }),
    ...(extras.source === undefined ? {} : { source: extras.source }),
    ...(extras.collapsed === true ? { collapsed: true as const } : {}),
    ...(normalizedRating(extras.rating) === undefined ? {} : { rating: normalizedRating(extras.rating) }),
    ...(extras.order !== undefined && Number.isFinite(extras.order) ? { order: extras.order } : {}),
    ...(extras.box === undefined ? {} : { box: extras.box }),
    ...(extras.kind === 'region' && parseSnapshot(extras.snapshot) !== undefined ? { snapshot: parseSnapshot(extras.snapshot) } : {}),
  }
}

export interface PersistentPdfHighlightFile {
  readonly version: 1
  readonly highlights: readonly PersistentPdfHighlight[]
}

export function createPersistentPdfHighlight(
  anchor: Anchor,
  color: PdfHighlightColor = 'yellow',
  extras: HighlightExtras = {},
): PersistentPdfHighlight {
  return withExtras({ id: persistentHighlightId(anchor, extras.kind), anchor, color }, extras)
}

/** 글자 형광펜은 글자 범위로, 영역(표·그림)은 그 네모로 이름을 짓는다 */
export function persistentHighlightId(anchor: Anchor, kind?: 'region'): string {
  if (kind === 'region') {
    const rect = anchor.rects[0]
    const n = (value: number | undefined) => Math.round((value ?? 0) * 10) / 10
    return `${anchor.docId}:${anchor.page}:region:${n(rect?.x)}:${n(rect?.y)}:${n(rect?.w)}:${n(rect?.h)}`
  }
  const [start, end] = anchor.charRange
  return `${anchor.docId}:${anchor.page}:${start}:${end}`
}

/** 형광펜에서 고칠 수 있는 것: 색, 메모, 카테고리 */
export interface PersistentPdfHighlightPatch {
  readonly color?: PdfHighlightColor
  readonly note?: string
  /** 서식 HTML. 메모를 고칠 때 함께 준다('' 이면 서식을 지운다) */
  readonly noteHtml?: string
  readonly topic?: string
  /** 접기·펼치기 */
  readonly collapsed?: boolean
  /** 별점 1~5. 0 이면 지운다 */
  readonly rating?: number
  /** 목록 순서. null 이면 문서 순서로 되돌린다 */
  readonly order?: number | null
  /** 박스 메모의 자리·너비. null 이면 박스를 거둔다(일반 메모로) */
  readonly box?: MemoBox | null
  /** 표·그림(영역) 네모의 크기를 바꿨을 때 새 자리. id 는 그대로(노트가 id 로 가리킨다) */
  readonly anchor?: Anchor
}

/** 색·메모·카테고리를 바꾼다. 빈 메모·빈 카테고리는 그 값을 지운다 */
export function updatePersistentPdfHighlight(
  highlight: PersistentPdfHighlight,
  patch: PersistentPdfHighlightPatch,
): PersistentPdfHighlight {
  const { note: _note, noteHtml: _noteHtml, topic: _topic, kind: _kind, pageSize: _pageSize, collapsed: _collapsed, rating: _rating, order: _order, box: _box, snapshot: _snapshot, ...rest } = highlight
  return withExtras({ ...rest, ...(patch.anchor === undefined ? {} : { anchor: patch.anchor }), color: patch.color ?? highlight.color }, {
    note: patch.note === undefined ? highlight.note : patch.note,
    // 글만 고치고 서식을 안 주면(MCP 등) 예전 서식은 버린다(글과 어긋나지 않게)
    noteHtml: patch.noteHtml !== undefined ? patch.noteHtml : patch.note === undefined ? highlight.noteHtml : undefined,
    kind: highlight.kind,
    pageSize: highlight.pageSize,
    topic: patch.topic === undefined ? highlight.topic : patch.topic,
    createdAt: highlight.createdAt,
    source: highlight.source,
    collapsed: patch.collapsed === undefined ? highlight.collapsed : patch.collapsed,
    rating: patch.rating === undefined ? highlight.rating : patch.rating,
    order: patch.order === undefined ? highlight.order : patch.order ?? undefined,
    box: patch.box === undefined ? highlight.box : patch.box ?? undefined,
    snapshot: highlight.snapshot,
  })
}

/**
 * 메모 목록의 순서: 문서 순서(쪽, 위→아래)를 바탕으로, 사용자가 끌어 정한 순서(order)가 있으면 그것을 따른다.
 * 순서가 없는 메모(나중에 만든 것)는 문서에서 바로 앞에 있는 메모 뒤에 붙는다.
 */
export function sortMemosForList<T>(items: readonly T[], highlightOf: (item: T) => PersistentPdfHighlight, docTop: (item: T) => number): T[] {
  const inDocOrder = [...items].sort((a, b) => {
    const left = highlightOf(a)
    const right = highlightOf(b)
    return left.anchor.page - right.anchor.page || docTop(a) - docTop(b)
  })
  let previous = -1
  const keyed = inDocOrder.map((item, index) => {
    const order = highlightOf(item).order
    const key = order ?? previous + 0.001
    previous = key
    return { item, key, index }
  })
  return keyed.sort((a, b) => a.key - b.key || a.index - b.index).map(({ item }) => item)
}

export function removePersistentPdfHighlight(
  highlights: readonly PersistentPdfHighlight[],
  highlightId: string,
): readonly PersistentPdfHighlight[] {
  return highlights.filter(({ id }) => id !== highlightId)
}

function isHighlightColor(value: unknown): value is PdfHighlightColor {
  return value === 'yellow' || value === 'green' || value === 'blue' || value === 'pink'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isAnchor(value: unknown): value is Anchor {
  return isRecord(value)
    && typeof value.docId === 'string'
    && Number.isInteger(value.page)
    && (value.page as number) >= 0
    && value.coordSpace === 'pdfium-page'
    && Array.isArray(value.rects)
    && value.rects.every((rect) => isRecord(rect)
      && isFiniteNumber(rect.x)
      && isFiniteNumber(rect.y)
      && isFiniteNumber(rect.w)
      && rect.w > 0
      && isFiniteNumber(rect.h)
      && rect.h > 0)
    && Array.isArray(value.charRange)
    && value.charRange.length === 2
    && value.charRange.every((offset) => Number.isInteger(offset) && (offset as number) >= 0)
    && typeof value.quote === 'string'
    && typeof value.prefix === 'string'
    && typeof value.suffix === 'string'
}

export function parsePersistentPdfHighlights(value: unknown): PersistentPdfHighlight[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.highlights)) {
    throw new Error(t('PDF 형광펜 저장 형식이 잘못되었습니다.'))
  }
  const highlights: PersistentPdfHighlight[] = []
  const ids = new Set<string>()
  for (const item of value.highlights) {
    if (!isRecord(item) || typeof item.id !== 'string' || !isAnchor(item.anchor)) {
      throw new Error(t('PDF 형광펜 항목이 잘못되었습니다.'))
    }
    const color = item.color === undefined ? 'yellow' : item.color
    if (!isHighlightColor(color)) throw new Error(t('PDF 형광펜 색상이 잘못되었습니다.'))
    const kind = item.kind === 'region' ? 'region' as const : undefined
    // id 는 만들 때 정해진 이름표일 뿐이다. 쪽을 옮기거나 영역을 키워도 노트가 id 로 가리키므로 그대로 두어,
    // 지금 앵커에서 다시 만든 id 와 달라도 읽는다(예전엔 여기서 던져 파일 전체가 안 열렸다).
    if (item.id === '') throw new Error(t('PDF 형광펜 항목이 잘못되었습니다.'))
    if (ids.has(item.id)) continue
    ids.add(item.id)
    // 메모·시각·출처는 덧붙은 정보라, 모양이 틀리면 항목을 버리지 않고 그 값만 버린다.
    highlights.push(withExtras({ id: item.id, anchor: structuredClone(item.anchor), color }, {
      note: typeof item.note === 'string' ? item.note : undefined,
      noteHtml: typeof item.noteHtml === 'string' ? item.noteHtml : undefined,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
      source: item.source === 'iwae' || item.source === 'imported' ? item.source : undefined,
      kind,
      pageSize: Array.isArray(item.pageSize) && item.pageSize.length === 2 && item.pageSize.every(isFiniteNumber)
        ? [item.pageSize[0] as number, item.pageSize[1] as number] as const
        : undefined,
      topic: typeof item.topic === 'string' ? item.topic : undefined,
      collapsed: item.collapsed === true,
      rating: typeof item.rating === 'number' ? item.rating : undefined,
      order: typeof item.order === 'number' ? item.order : undefined,
      box: parseMemoBox(item.box),
      snapshot: parseSnapshot(item.snapshot),
    }))
  }
  return highlights
}

export function persistentPdfHighlightFile(
  highlights: readonly PersistentPdfHighlight[],
): PersistentPdfHighlightFile {
  return { version: 1, highlights: structuredClone(highlights) }
}
