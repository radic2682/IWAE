import { useSyncExternalStore } from 'react'
import type { PaneId } from './tabs'
import type { PaneChannel } from './workspaceChannels'

/**
 * 작업 공간 연결선(docs/design/workspace-channels.md 3.5)의 재료와 짝 맞추기.
 *
 * 창(문서·메모 노트 탭)은 「보이는 형광펜 / 보이는 카드」의 사각형만 재서 내놓고(measure),
 * 작업 공간 층(WorkspaceLinkLayer)이 짝을 맞춰 한 겹 위에 그린다. PdfPane 은 노트가 어느 쪽에 있는지 알 필요가 없다.
 *
 * 성능: 창은 읽기만 하는 measure 함수를 등록하고 「바뀌었다」고만 알린다(requestPaneLinks).
 * 같은 프레임의 알림은 하나로 합쳐 프레임마다 한 번, 모든 창을 읽고(읽기) → 짝을 맞추고 → 층을 고친다(쓰기).
 * 결과가 같으면 아무도 깨우지 않는다 — 스크롤 중 문서 창이 다시 그려지지 않는다.
 * DOM 을 모른다: 사각형 값만 다루므로 짝 맞추기·선 모양은 마우스 없이 시험한다.
 */

/** 화면(client) 좌표의 사각형 */
export interface LinkRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** 보이는 형광펜(문서 창) 또는 카드(노트 창) 하나. id 는 형광펜 id */
export interface LinkItem {
  readonly id: string
  readonly rect: LinkRect
  /** 선이 나가고 들어가는 세로 자리(화면 y). 글 형광펜은 첫 줄 위 가장자리, 카드는 머리 근처 */
  readonly y: number
  /** 형광펜 색(선 색이 된다) */
  readonly color?: string
}

/** 한 창이 이 순간 내놓은 것 */
export interface PaneLinkSnapshot {
  /** 창(칸) 전체. 이웃 판정에 쓴다 */
  readonly frame: LinkRect
  /** 스크롤 몸통. 보이는 것만 이 안에서 그린다 */
  readonly body: LinkRect
  /** 지금 보이는 형광펜 / 카드(몸통 안에 걸친 것만) */
  readonly items: readonly LinkItem[]
  /** 가리키는(활성·쓰는 중) 형광펜 id. 그 선은 실선으로 굵게 */
  readonly activeIds: readonly string[]
}

/** 창이 내놓는 것의 역할: 문서(형광펜), 메모 노트(카드), 캔버스(출처가 있는 블록) */
export type LinkRole = 'document' | 'note' | 'canvas'

/** 문서 창이 내놓는 「캔버스 블록의 출처 자리」의 id 앞머리(src:블록id). 이어진 메모(형광펜)가 없는 블록은 이 id 로 잇는다 */
export const SOURCE_LINK_PREFIX = 'src:'

export interface PaneLinkMeta {
  readonly pane: PaneId
  readonly role: LinkRole
  readonly channel: PaneChannel
  /** 문서 창이 보는 문서(노트 카드가 「원문이 옆에 보이는가」를 알아보는 데 쓴다) */
  readonly docId?: string
}

export type LinkSide = 'left' | 'right'

/** 두 창이 이웃으로 치는 칸막이 틈(px)과 세로로 겹쳐야 하는 길이 */
export const LINK_PANE_GAP = 12
export const LINK_MIN_OVERLAP = 24
/** 너비·높이가 이보다 작은 창(접힌 창)은 이웃으로 치지 않는다 */
export const LINK_MIN_PANE = 40

const width = (rect: LinkRect) => rect.right - rect.left
const height = (rect: LinkRect) => rect.bottom - rect.top

/**
 * other 가 from 의 오른쪽·왼쪽 이웃인가: 가로로 맞닿고(칸막이 틈 안) 세로 범위가 겹친다.
 * 위아래로 맞닿은 칸, 떨어져 있는 칸(사이에 다른 칸이 있다)은 null.
 */
export function neighborSide(from: LinkRect, other: LinkRect): LinkSide | null {
  if (width(from) < LINK_MIN_PANE || width(other) < LINK_MIN_PANE || height(from) < LINK_MIN_PANE || height(other) < LINK_MIN_PANE) return null
  const overlap = Math.min(from.bottom, other.bottom) - Math.max(from.top, other.top)
  if (overlap < LINK_MIN_OVERLAP) return null
  if (Math.abs(other.left - from.right) <= LINK_PANE_GAP) return 'right'
  if (Math.abs(from.left - other.right) <= LINK_PANE_GAP) return 'left'
  return null
}

/**
 * other 가 from 의 오른쪽·왼쪽에 있는가(떨어져 있어도 된다). 칸막이 틈 안에서 가로 범위가 겹치면(위아래로 쌓인 칸) null.
 * 선은 이 방향의 가장자리로 나가 상대 창의 마주 보는 가장자리로 들어간다. 접힌 창은 null.
 */
export function facingSide(from: LinkRect, other: LinkRect): LinkSide | null {
  if (width(from) < LINK_MIN_PANE || width(other) < LINK_MIN_PANE || height(from) < LINK_MIN_PANE || height(other) < LINK_MIN_PANE) return null
  if (other.left >= from.right - LINK_PANE_GAP) return 'right'
  if (other.right <= from.left + LINK_PANE_GAP) return 'left'
  return null
}

export interface LinkPaneEntry extends PaneLinkMeta {
  readonly frame: LinkRect
}

/** 두 사각형이 눈에 띄게(1px 넘게) 겹치는가 */
export function rectsOverlap(a: LinkRect, b: LinkRect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
}

/** 이어지는 문서 창 ↔ 노트(또는 캔버스) 창 한 쌍. noteSide: 노트가 문서의 어느 쪽에 있는가 */
export interface LinkPair {
  readonly doc: PaneId
  readonly note: PaneId
  /** 노트 쪽이 메모 노트인가 캔버스인가 */
  readonly noteRole: 'note' | 'canvas'
  readonly noteSide: LinkSide
  readonly docId: string | null
  /** 두 칸 사이의 가로 거리(px). 같은 문서가 여러 칸에 보일 때 가까운 칸을 고르는 데 쓴다 */
  readonly distance: number
}

/**
 * 짝 맞추기: 채널이 있고 같으며, 보이는 탭이 문서와 메모 노트(또는 캔버스)인 창끼리 — 이웃하지 않아도 잇는다(사이에 다른 칸이 있어도 된다).
 * 좌우로 마주 볼 수 있는 칸만(위아래로 쌓인 칸은 나가는 가장자리가 없다). 격자 배치든 좌우 배치든 실제 칸 사각형으로 가른다.
 * 떠 있는 칸(floating)이 상대 칸과 겹치면 선을 잇지 않는다 — 카드 강조만 한다(설계 5). 겹치지 않는 떠 있는 칸은 보통 칸처럼 짝이 된다.
 */
export function pairLinkedPanes(entries: readonly LinkPaneEntry[], floating: ReadonlySet<PaneId> = new Set()): LinkPair[] {
  const pairs: LinkPair[] = []
  for (const doc of entries) {
    if (doc.role !== 'document' || doc.channel === null) continue
    for (const note of entries) {
      if (note.role === 'document' || note.channel !== doc.channel || note.pane === doc.pane) continue
      if ((floating.has(doc.pane) || floating.has(note.pane)) && rectsOverlap(doc.frame, note.frame)) continue
      const noteSide = facingSide(doc.frame, note.frame)
      if (noteSide === null) continue
      const distance = noteSide === 'right' ? note.frame.left - doc.frame.right : doc.frame.left - note.frame.right
      pairs.push({ doc: doc.pane, note: note.pane, noteRole: note.role, noteSide, docId: doc.docId ?? null, distance: Math.max(0, distance) })
    }
  }
  return pairs
}

/** 층이 그리는 선 하나(화면 좌표). 형광펜 끝 → 문서 창 가장자리까지 곧게, 거기서 카드 가까운 쪽 가장자리까지 곡선(한 줄) */
export interface LinkLine {
  /** 층 안에서 유일한 열쇠(같은 형광펜이 노트와 캔버스 둘에 이어질 수 있다) */
  readonly key: string
  readonly id: string
  readonly color?: string
  readonly active: boolean
  readonly side: LinkSide
  /** 선이 들어가는 노트(캔버스) 창. 같은 카드로 가는 선이 둘 이상이면 가까운 문서 칸 것만 남기는 데 쓴다 */
  readonly target: PaneId
  readonly distance: number
  /** 곡선이 지나가는 다른 칸들의 사각형(이 부분은 흐리게 그린다) */
  readonly crossing: readonly LinkRect[]
  /** 형광펜에서 나오는 점 */
  readonly startX: number
  readonly y: number
  /** 문서 창과 노트 창 사이 경계(점선이 끝나고 곡선이 시작하는 곳) */
  readonly edgeX: number
  readonly cardX: number
  readonly cardY: number
}

/** 카드 머리에서 선이 들어가는 깊이(px). 노트 카드의 안쪽 여백과 같다 */
export const LINK_CARD_DEPTH = 18

const within = (value: number, low: number, high: number) => value >= low && value <= high

/**
 * 한 쌍의 선: 같은 id 의 보이는 형광펜과 보이는 카드가 둘 다 있을 때만, 각 몸통 안에 걸친 것만.
 * 노트가 오른쪽이면 형광펜의 오른쪽 끝에서 오른쪽으로, 왼쪽이면 왼쪽 끝에서 왼쪽으로 간다.
 * 가리키는 선(활성)은 맨 뒤에 둬 위에 그려진다.
 */
export function linkLines(pair: LinkPair, doc: PaneLinkSnapshot, note: PaneLinkSnapshot, others: readonly LinkRect[] = []): LinkLine[] {
  const right = pair.noteSide === 'right'
  const cards = new Map<string, LinkItem>()
  for (const card of note.items) if (!cards.has(card.id)) cards.set(card.id, card)
  const activeIds = new Set([...doc.activeIds, ...note.activeIds])
  const edgeX = right ? doc.frame.right : doc.frame.left
  const lines: LinkLine[] = []
  for (const mark of doc.items) {
    const card = cards.get(mark.id)
    if (card === undefined) continue
    const startX = right ? mark.rect.right : mark.rect.left
    const cardY = card.y
    if (!within(startX, doc.body.left, doc.body.right) || !within(mark.y, doc.body.top, doc.body.bottom)) continue
    if (!within(cardY, note.body.top, note.body.bottom)) continue
    const cardX = right ? card.rect.left : card.rect.right
    // 곡선이 가로지르는 다른 칸(문서·노트 둘 말고): 선이 지나가는 가로 구간 안에 들고 세로 범위가 겹친다
    const low = Math.min(edgeX, cardX)
    const high = Math.max(edgeX, cardX)
    const top = Math.min(mark.y, cardY)
    const bottom = Math.max(mark.y, cardY)
    const crossing = others.filter((frame) => frame.right - 1 > low && frame.left + 1 < high && frame.bottom > top && frame.top < bottom)
    lines.push({
      key: `${pair.doc}>${pair.note}:${mark.id}`,
      id: mark.id,
      target: pair.note,
      distance: pair.distance,
      crossing,
      ...(mark.color === undefined ? {} : { color: mark.color }),
      active: activeIds.has(mark.id),
      side: pair.noteSide,
      startX,
      y: mark.y,
      edgeX,
      cardX,
      cardY,
    })
  }
  return lines.sort((a, b) => Number(a.active) - Number(b.active))
}

/**
 * 같은 노트 창의 같은 카드로 가는 선이 둘 이상이면(같은 문서가 여러 칸에 보인다) 가까운 문서 칸의 선 하나만 남긴다.
 * 가까운 칸에서 형광펜이 화면 밖이면 그 선이 없으므로 먼 칸의 것이 남는다. 순서는 그대로.
 */
export function dedupeLinkLines(lines: readonly LinkLine[]): LinkLine[] {
  const best = new Map<string, LinkLine>()
  for (const line of lines) {
    const slot = `${line.target}|${line.id}`
    const held = best.get(slot)
    if (held === undefined || line.distance < held.distance) best.set(slot, line)
  }
  return lines.filter((line) => best.get(`${line.target}|${line.id}`) === line)
}

/**
 * 몸통 안에 걸친 항목만 고른다. 항목이 위에서 아래로 놓여 있다고 보고 지난 번에 찾은 자리(hint)에서 출발해
 * 화면 안쪽만 훑는다 — 카드가 1,000 장이어도 읽는 것은 보이는 몇 장 + 앞뒤 한두 장.
 * rectAt 이 null 이면 그리지 않는 항목(접힘)이라 건너뛴다. 돌려주는 first 는 다음 번 hint.
 */
export function visibleSlice(count: number, rectAt: (index: number) => { readonly top: number; readonly bottom: number } | null, top: number, bottom: number, hint = 0): { readonly indexes: number[]; readonly first: number } {
  if (count <= 0) return { indexes: [], first: 0 }
  // 한 번 읽은 자리는 다시 읽지 않는다
  const cache = new Map<number, { readonly top: number; readonly bottom: number } | null>()
  const read = (index: number) => {
    if (!cache.has(index)) cache.set(index, rectAt(index))
    return cache.get(index) ?? null
  }
  // 힌트 자리 또는 그 뒤의 첫 그리는 항목을 기준으로 삼는다
  const from = Math.min(Math.max(hint, 0), count - 1)
  let anchor = -1
  for (let at = from; at < count; at += 1) {
    if (read(at) !== null) { anchor = at; break }
  }
  if (anchor < 0) {
    for (let at = from - 1; at >= 0; at -= 1) {
      if (read(at) !== null) { anchor = at; break }
    }
  }
  if (anchor < 0) return { indexes: [], first: 0 }
  let start = anchor
  if (read(anchor)!.bottom < top) {
    // 기준이 화면 위쪽: 아래로 내려가 처음 화면에 닿는 항목까지
    for (let at = anchor + 1; at < count; at += 1) {
      const rect = read(at)
      if (rect === null) continue
      start = at
      if (rect.bottom >= top) break
    }
  } else {
    // 기준이 화면 안이거나 아래쪽: 위로 올라가며 아직 화면에 닿는 항목이 있는 동안
    for (let at = anchor - 1; at >= 0; at -= 1) {
      const rect = read(at)
      if (rect === null) continue
      if (rect.bottom < top) break
      start = at
    }
  }
  const indexes: number[] = []
  for (let at = start; at < count; at += 1) {
    const rect = read(at)
    if (rect === null) continue
    if (rect.top > bottom) break
    if (rect.bottom >= top) indexes.push(at)
  }
  return { indexes, first: start }
}

// ---------- 등록과 한 프레임 한 번 재기 ----------

interface Registration {
  readonly meta: PaneLinkMeta
  readonly measure: () => PaneLinkSnapshot | null
  readonly token: symbol
}

/** 층이 그려질 자리를 알려 준다(선의 화면 좌표를 층 안 좌표로 바꾸는 데 쓴다) */
export interface LinkLayerState {
  readonly originX: number
  readonly originY: number
  readonly lines: readonly LinkLine[]
  /** 선을 그려도 되는 곳(칸 영역). 사이드바·상단바 위로는 그리지 않는다. 모르면 null */
  readonly clip: LinkRect | null
}

const EMPTY_LAYER: LinkLayerState = { originX: 0, originY: 0, lines: [], clip: null }
const NO_DOC_IDS: readonly string[] = []

const registry = new Map<PaneId, Registration>()
/** 떠 있는 칸의 id 들(App 이 알려 준다). 문서 칸과 겹치는 떠 있는 칸은 선을 잇지 않는다 */
let floatingPanes: ReadonlySet<PaneId> = new Set()
const snapshots = new Map<PaneId, PaneLinkSnapshot>()
let pairs: readonly LinkPair[] = []
let pairsKey = ''
let layerState: LinkLayerState = EMPTY_LAYER
let layerKey = ''
let layerElement: Element | null = null
let linkedDocIds = new Map<PaneId, readonly string[]>()
const pairListeners = new Set<() => void>()
const layerListeners = new Set<() => void>()
let scheduled: ReturnType<typeof setTimeout> | number | null = null
let scheduledByTimeout = false

function notify(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) listener()
}

const round = (value: number) => Math.round(value * 10) / 10

const rectKey = (rect: LinkRect) => [rect.left, rect.top, rect.right, rect.bottom].map(round).join(' ')

function lineKey(line: LinkLine): string {
  return [line.key, line.id, line.color ?? '', line.active ? 1 : 0, line.side, round(line.startX), round(line.y), round(line.edgeX), round(line.cardX), round(line.cardY), line.crossing.map(rectKey).join(';')].join(',')
}

/** 층과 같은 부모 안의 칸(카드) 사각형들. 선이 지나가는 가운데 칸을 알아내는 데 쓴다 */
function readPaneFrames(): Map<PaneId, LinkRect> {
  const frames = new Map<PaneId, LinkRect>()
  const scope = layerElement?.parentElement
  if (scope === null || scope === undefined) return frames
  for (const card of scope.querySelectorAll<HTMLElement>('[data-card-pane]')) {
    const rect = card.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) frames.set(card.dataset.cardPane as PaneId, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
  }
  return frames
}

/** 칸 영역(.panes). 사이드바·상단바는 이 밖이라 선이 넘어가지 않는다 */
function readPaneArea(): LinkRect | null {
  const area = layerElement?.parentElement?.querySelector('.panes')
  if (area === null || area === undefined) return null
  const rect = area.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
}

/** 모은 창 사각형으로 짝과 선을 다시 셈한다. 바뀐 쪽만 알린다 */
function recompute(): void {
  const entries: LinkPaneEntry[] = []
  for (const [pane, registration] of registry) {
    const snapshot = snapshots.get(pane)
    if (snapshot !== undefined) entries.push({ ...registration.meta, frame: snapshot.frame })
  }
  const nextPairs = pairLinkedPanes(entries, floatingPanes)
  const nextPairsKey = nextPairs.map((pair) => `${pair.doc}>${pair.note}:${pair.noteRole}:${pair.noteSide}:${pair.docId ?? ''}:${round(pair.distance)}`).join('|')
  if (nextPairsKey !== pairsKey) {
    pairsKey = nextPairsKey
    pairs = nextPairs
    const byNote = new Map<PaneId, string[]>()
    for (const pair of nextPairs) {
      if (pair.docId === null || pair.noteRole !== 'note') continue
      byNote.set(pair.note, [...(byNote.get(pair.note) ?? []), pair.docId])
    }
    linkedDocIds = byNote
    notify(pairListeners)
  }
  // 칸 사각형·칸 영역·층의 자리는 그릴 선이 있을 때만 읽는다(선이 없으면 위치를 잴 일이 없다)
  const frames = nextPairs.length === 0 ? new Map<PaneId, LinkRect>() : readPaneFrames()
  const lines = dedupeLinkLines(nextPairs.flatMap((pair) => {
    const doc = snapshots.get(pair.doc)
    const note = snapshots.get(pair.note)
    if (doc === undefined || note === undefined) return []
    const others = [...frames].filter(([pane]) => pane !== pair.doc && pane !== pair.note).map(([, frame]) => frame)
    return linkLines(pair, doc, note, others)
  })).sort((a, b) => Number(a.active) - Number(b.active))
  const box = lines.length === 0 ? undefined : layerElement?.getBoundingClientRect()
  const originX = box?.left ?? 0
  const originY = box?.top ?? 0
  const clip = lines.length === 0 ? null : readPaneArea()
  const nextLayerKey = `${round(originX)},${round(originY)}|${clip === null ? '' : rectKey(clip)}|${lines.map(lineKey).join('|')}`
  if (nextLayerKey !== layerKey) {
    layerKey = nextLayerKey
    layerState = lines.length === 0 && originX === 0 && originY === 0 ? EMPTY_LAYER : { originX, originY, lines, clip }
    notify(layerListeners)
  }
}

/**
 * 모든 창을 한 번에 읽고(읽기만) 짝·선을 다시 셈한다. 채널이 없거나 짝이 될 창이 없는 쪽은 재지 않는다.
 * 보통은 requestPaneLinks 가 프레임에 한 번 부른다. 등록·해제는 짝이 바로 바뀌어야 하므로 직접 부른다(시험도 이걸 쓴다).
 */
export function flushPaneLinks(): void {
  if (scheduled !== null) {
    if (scheduledByTimeout) clearTimeout(scheduled as ReturnType<typeof setTimeout>)
    else cancelAnimationFrame(scheduled as number)
    scheduled = null
  }
  const docChannels = new Set<PaneChannel>()
  const noteChannels = new Set<PaneChannel>()
  for (const { meta } of registry.values()) (meta.role === 'document' ? docChannels : noteChannels).add(meta.channel)
  snapshots.clear()
  for (const [pane, { meta, measure }] of registry) {
    if (meta.channel === null || !(meta.role === 'document' ? noteChannels : docChannels).has(meta.channel)) continue
    const snapshot = measure()
    if (snapshot !== null) snapshots.set(pane, snapshot)
  }
  recompute()
}

/** 떠 있는 칸의 id 들을 알린다(바뀌었으면 짝을 다시 셈한다) */
export function setFloatingLinkPanes(ids: readonly PaneId[]): void {
  if (ids.length === floatingPanes.size && ids.every((id) => floatingPanes.has(id))) return
  floatingPanes = new Set(ids)
  requestPaneLinks()
}

/** 무언가 바뀌었다(스크롤·배치·크기·카드 목록). 같은 프레임의 알림은 하나로 합친다 */
export function requestPaneLinks(): void {
  if (scheduled !== null) return
  if (typeof requestAnimationFrame === 'function') {
    scheduledByTimeout = false
    scheduled = requestAnimationFrame(() => {
      scheduled = null
      flushPaneLinks()
    })
    return
  }
  scheduledByTimeout = true
  scheduled = setTimeout(() => {
    scheduled = null
    flushPaneLinks()
  }, 16)
}

/**
 * 창이 자기 보이는 탭의 measure 를 등록한다(탭을 바꾸거나 닫으면 돌려받은 함수로 거둔다).
 * 같은 창의 새 등록이 옛 등록을 덮어쓰고, 옛 등록의 거둠은 새 것을 지우지 않는다(탭 전환 중 순서가 뒤바뀌어도 안전하다).
 * 짝이 바로 바뀌도록 등록·거둠은 그 자리에서 다시 잰다.
 */
export function registerPaneLinks(meta: PaneLinkMeta, measure: () => PaneLinkSnapshot | null): () => void {
  const token = Symbol(meta.pane)
  registry.set(meta.pane, { meta, measure, token })
  flushPaneLinks()
  return () => {
    if (registry.get(meta.pane)?.token !== token) return
    registry.delete(meta.pane)
    snapshots.delete(meta.pane)
    recompute()
    requestPaneLinks()
  }
}

/** 층 요소를 알려 준다(선 좌표의 기준점). 언마운트 때 null */
export function setLinkLayerElement(element: Element | null): void {
  layerElement = element
  if (element !== null) requestPaneLinks()
}

export function getLinkLayerState(): LinkLayerState {
  return layerState
}
export function subscribeLinkLayer(listener: () => void): () => void {
  layerListeners.add(listener)
  return () => { layerListeners.delete(listener) }
}

/** 이 노트 창과 이웃한 같은 색 문서 창이 보는 문서들(카드의 원문이 옆에 보이는가) */
export function useLinkedDocIds(pane: PaneId | null): readonly string[] {
  return useSyncExternalStore(
    (listener) => { pairListeners.add(listener); return () => { pairListeners.delete(listener) } },
    () => (pane === null ? NO_DOC_IDS : linkedDocIds.get(pane) ?? NO_DOC_IDS),
    () => NO_DOC_IDS,
  )
}

/** 짝이 바뀔 때 알린다(옛 출처 추적선이 층의 선과 겹치지 않게 다시 잰다) */
export function subscribeLinkPairs(listener: () => void): () => void {
  pairListeners.add(listener)
  return () => { pairListeners.delete(listener) }
}

/**
 * 이 캔버스 창이 docId 문서를 보는 문서 창과 이웃해 층이 선을 그리는가.
 * 그러면 옛 출처 추적선(SourceTrace)은 같은 선을 또 그리지 않는다 — 이웃하지 않은 경우에만 옛 선이 남는다.
 */
export function isCanvasLinkedToDoc(canvasPane: string | null, docId: string): boolean {
  return canvasPane !== null && pairs.some((pair) => pair.noteRole === 'canvas' && pair.note === canvasPane && pair.docId === docId)
}

/** 시험용: 등록·짝·층을 모두 비운다 */
export function resetPaneLinks(): void {
  registry.clear()
  floatingPanes = new Set()
  snapshots.clear()
  pairs = []
  pairsKey = ''
  layerState = EMPTY_LAYER
  layerKey = ''
  layerElement = null
  linkedDocIds = new Map()
  pairListeners.clear()
  layerListeners.clear()
  if (scheduled !== null) {
    if (scheduledByTimeout) clearTimeout(scheduled as ReturnType<typeof setTimeout>)
    else cancelAnimationFrame(scheduled as number)
    scheduled = null
  }
}

/** 시험용: 지금 짝 */
export function currentLinkPairs(): readonly LinkPair[] {
  return pairs
}
