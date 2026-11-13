/**
 * 메모 블록 끌기의 노트 밖 쪽: 손에 붙어 따라오는 모양(ghost), 놓을 노트 찾기, 탭 위에 얹어 노트 바꾸기(spring-load),
 * Alt 로 링크·복사, 노트 사이 옮기기. 같은 노트 안 순서 바꾸기는 NoteFlow 가 그대로 맡고, 여기는 「다른 노트 위에 있는가」만 안다.
 *
 * 놓을 자리는 마우스 밑 요소가 아니라 칸의 자리(paneHitAt)로 정한다 — 끄는 동안 칸 안 내용은 마우스를 받지 않는다(note-block-drag.css).
 */

import { paneHitAt } from '../app/tabDrag'
import { anchorGhostBelowRight } from '../app/ghostPlace'
import { announceAction } from '../app/actionFeedback'
import { lastUndoGroup, recordSeparately, resumeUndoGroup } from '../app/undoStack'
import { t } from '../i18n'
import { carriedBlocks, linkBlocksInto, moveBlocksBetweenNotes, removeBlocksById, type BlocksIntoResult } from '../core/memoNote'
import { revealNoteBlock, type MemoNoteApi } from './memoNoteContext'
import '../ui/note-block-drag.css'

/** 탭 위에 이만큼 머물면 그 노트 탭이 보이는 탭이 된다 */
export const SPRING_LOAD_MS = 450
/** 끌기 ghost 의 가장 큰 폭(카드가 더 좁으면 카드 폭) */
const GHOST_MAX_WIDTH = 280
/** 노트 가장자리에서 이만큼 안이면 스크롤한다(원래 노트와 같은 값) */
const EDGE_SCROLL_BAND = 30
const EDGE_SCROLL_STEP = 12

/** 블록을 놓을 곳 */
export type NoteDropTarget =
  /** 칸 본문에 보이는 노트. 포인터 자리의 카드 사이에 놓는다 */
  | { readonly kind: 'body'; readonly path: string; readonly scroller: HTMLElement; readonly card: HTMLElement }
  /** 노트 탭 알약 위: 그 노트의 맨 끝에 붙인다 */
  | { readonly kind: 'tab'; readonly path: string; readonly pill: HTMLElement }

const isTransparent = (color: string) => color === '' || color === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/u.test(color)

const visible = (element: HTMLElement) => element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0

/**
 * 화면 한 점 아래의 노트(sourcePath 의 노트는 빼고). 노트 탭 알약 위면 탭, 칸 본문이면 그 칸에 보이는 노트.
 * 노트가 아닌 탭 · 노트가 아닌 칸 · 칸 밖이면 null
 */
export function noteTargetAt(x: number, y: number, sourcePath: string | null): NoteDropTarget | null {
  const element = document.elementFromPoint(x, y)
  const pill = element?.closest<HTMLElement>('.pane-top-tab') ?? null
  if (pill !== null) {
    const path = pill.dataset.tabId
    if (path === undefined || !pill.classList.contains('pane-top-tab-memoNote') || path === sourcePath) return null
    return { kind: 'tab', path, pill }
  }
  const hit = paneHitAt(x, y)
  if (hit.kind !== 'body') return null
  const scrollers = Array.from(hit.card.querySelectorAll<HTMLElement>('[data-note-path]')).filter(visible)
  const scroller = scrollers[0]
  const path = scroller?.dataset.notePath
  if (scroller === undefined || path === undefined || path === sourcePath) return null
  return { kind: 'body', path, scroller, card: hit.card }
}

/** 노트의 카드들(그리는 차례). 쓰는 중인 새 메모(draft)는 놓을 자리가 아니다 */
export function cardsOf(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-note-block]')).filter((card) => card.dataset.noteBlock !== 'draft')
}

/** 위쪽이 `y` 아래에 처음 오는(가운데선이 포인터보다 아래인) 칸의 차례. 없으면 -1. 노트 안 순서 바꾸기(NoteFlow)와 노트 사이 옮기기가 같은 규칙을 쓴다 */
export function firstBelowMidpoint(rects: Iterable<{ readonly top: number; readonly height: number } | undefined>, y: number): number {
  let index = 0
  for (const rect of rects) {
    if (rect !== undefined && y < rect.top + rect.height / 2) return index
    index += 1
  }
  return -1
}

/** 노트 가장자리에서 이만큼 안이면 스크롤한다(노트 안 끌기와 노트 사이 끌기가 같은 값) */
export function edgeScroll(scroller: Element, clientY: number): void {
  const rect = scroller.getBoundingClientRect()
  if (clientY < rect.top + EDGE_SCROLL_BAND) scroller.scrollTop -= EDGE_SCROLL_STEP
  else if (clientY > rect.bottom - EDGE_SCROLL_BAND) scroller.scrollTop += EDGE_SCROLL_STEP
}

/** 포인터 높이에서 놓을 자리: 가운데선 아래로 처음 내려가는 카드 앞(없으면 null = 맨 끝). cards 를 주면 다시 찾지 않는다 */
export function dropBeforeIdAt(scroller: HTMLElement, clientY: number, cards: readonly HTMLElement[] = cardsOf(scroller)): string | null {
  const at = firstBelowMidpoint(cards.map((card) => card.getBoundingClientRect()), clientY)
  return at < 0 ? null : cards[at]?.dataset.noteBlock ?? null
}

/** 줄이 칠해진 카드와 칠한 자리(같은 자리면 다시 칠하지 않는다: 클래스를 뗐다 붙이면 margin 이 바뀌어 매번 다시 배치된다) */
let paintedLine: { readonly scroller: HTMLElement; readonly beforeId: string | null; readonly card: Element | undefined } | null = null

/** 놓을 자리 줄을 그린다(원래 노트가 쓰는 클래스 그대로). beforeId 가 null 이면 마지막 카드 아래. scroller/beforeId 가 그대로면 아무것도 안 한다 */
function paintDropLine(scroller: HTMLElement | null, beforeId: string | null, cards?: readonly HTMLElement[]): void {
  if (scroller !== null && paintedLine?.scroller === scroller && paintedLine.beforeId === beforeId && (paintedLine.card === undefined || paintedLine.card.classList.contains('note-block-ghost-line'))) return
  if (paintedLine?.card !== undefined) paintedLine.card.classList.remove('pdf-memo-card-drop-before', 'pdf-memo-card-drop-after', 'note-block-ghost-line')
  paintedLine = null
  if (scroller === null) return
  const list = cards ?? cardsOf(scroller)
  const anchor = beforeId === null ? list.at(-1) : list.find((card) => card.dataset.noteBlock === beforeId)
  anchor?.classList.add(beforeId === null ? 'pdf-memo-card-drop-after' : 'pdf-memo-card-drop-before', 'note-block-ghost-line')
  paintedLine = { scroller, beforeId, card: anchor }
}

// ---------- 따라오는 모양 ----------

const SVG_LINK = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.7.7"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.7-.7"/></svg>'
const SVG_COPY = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>'

export interface BlockGhost {
  readonly move: (x: number, y: number) => void
  /** Alt 를 누른 동안의 이름표. mode null 이면 숨김, dimmed 는 놓아도 아무 일도 없는 자리 */
  readonly setBadge: (mode: 'link' | 'copy' | null, dimmed: boolean) => void
  readonly remove: () => void
}

/** 끌기 ghost 에 보일 글: 소제목은 제목, 글 블록 · 메모 블록은 본문(내 글), 내 글이 없는 형광펜은 원문 인용(그림이면 「표·그림」) */
export function ghostTextOf(card: HTMLElement): string {
  const pick = (selector: string) => card.querySelector<HTMLElement>(selector)?.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
  const section = pick('.note-section-title')
  if (section !== '') return section
  const own = pick('.pdf-memo-card-text')
  if (own !== '') return own
  const quote = pick('.note-source-quote') || pick('.note-source-chip-text')
  if (quote !== '') return quote
  return card.querySelector('.note-source-region') !== null ? t('표·그림') : ''
}

/**
 * 손에 붙어 따라오는 작은 카드: 불투명한 카드 바탕에 블록의 글만 두 줄로(말줄임). 출처 줄 · 탭 · 단추는 복사하지 않는다.
 * 포인터의 오른쪽 아래에 떠서 포인터 밑(놓을 자리 줄 · 탭 알약)을 가리지 않는다. 링크·복사 이름표는 카드 밖 왼쪽 아래 모서리에 걸친다.
 */
export function createBlockGhost(card: HTMLElement, startX: number, startY: number, count: number): BlockGhost {
  const rect = card.getBoundingClientRect()
  const width = Math.max(80, Math.min(GHOST_MAX_WIDTH, rect.width))
  const isSection = card.classList.contains('note-section')

  const root = document.createElement('div')
  root.className = 'note-block-ghost'
  root.setAttribute('aria-hidden', 'true')
  root.style.width = `${width}px`
  // 어두운 테마에서도 「내가 든 그 카드」로 보이도록 원래 카드의 바탕 · 글자색 · 모서리를 그대로 쓴다.
  // 소제목 줄처럼 바탕이 투명하면 가장 가까운 불투명한 조상의 바탕을 쓴다
  const computed = getComputedStyle(card)
  let background = computed.backgroundColor
  for (let up: HTMLElement | null = card; up !== null && isTransparent(background); up = up.parentElement) background = getComputedStyle(up).backgroundColor
  if (!isTransparent(background)) root.style.backgroundColor = background
  if (computed.color !== '') {
    root.style.color = computed.color
    root.style.borderColor = `color-mix(in srgb, ${computed.color} 14%, transparent)`
  }
  if (computed.borderRadius !== '') root.style.borderRadius = computed.borderRadius
  const text = document.createElement('div')
  text.className = isSection ? 'note-block-ghost-text note-block-ghost-title' : 'note-block-ghost-text'
  text.textContent = ghostTextOf(card)
  root.append(text)

  if (count > 1) {
    const badge = document.createElement('span')
    badge.className = 'note-block-ghost-count'
    badge.textContent = String(count)
    root.append(badge)
  }
  const mode = document.createElement('span')
  mode.className = 'note-block-ghost-mode'
  mode.hidden = true
  root.append(mode)

  const place = (x: number, y: number) => {
    const at = anchorGhostBelowRight(x, y, root.offsetWidth || width, root.offsetHeight || 40, window.innerWidth, window.innerHeight)
    root.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`
  }
  document.body.append(root)
  place(startX, startY)
  let shown: 'link' | 'copy' | null = null
  return {
    move: place,
    setBadge: (next, dimmed) => {
      if (next !== shown) {
        shown = next
        mode.hidden = next === null
        if (next !== null) mode.innerHTML = `${next === 'link' ? SVG_LINK : SVG_COPY}<span>${next === 'link' ? t('링크') : t('복사')}</span>`
      }
      mode.classList.toggle('note-block-ghost-mode-dim', dimmed)
    },
    remove: () => root.remove(),
  }
}

// ---------- 놓아서 일어나는 일 ----------

export interface TransferInput {
  readonly api: MemoNoteApi
  readonly sourcePath: string
  readonly target: NoteDropTarget
  /** 들고 온 블록의 key(고른 블록이거나 끈 블록 하나) */
  readonly keys: readonly string[]
  /** 놓을 자리: 이 블록 앞(null 이면 맨 끝) */
  readonly beforeId: string | null
  /** Alt: 옮기지 않고 링크·복사 */
  readonly link: boolean
  /** 끈 것이 소제목 하나(다른 묶음 한가운데로 들어가지 않게 한다) */
  readonly snapSection: boolean
}

/**
 * 블록을 다른 노트에 옮기거나(링크·복사) 한다. 받는 노트를 먼저 쓰고, 그 노트가 파일에 쓰였다는 것까지 확인한 뒤에만 원래 노트에서 지운다 —
 * updateNoteAt 은 메모리만 바꾸고 저장은 잠시 뒤로 미루며, 저장 충돌로 붙들린 노트는 아예 디스크에 쓰지 않으므로 「바뀌었다」만으로는 안전하지 않다.
 * 그래서 충돌로 붙들린 노트로 옮기기는 거절하고(링크 · 복사는 아무것도 지우지 않으니 된다), 옮기기는 받는 노트의 저장을 기다린 뒤 지운다.
 * 실패하면 알리고 원래 노트는 건드리지 않는다(받는 노트에 사본만 남을 수 있다 — 잃는 것보다 낫다). 되돌리기는 한 번(recordSeparately + 이어 붙이기)이다.
 * 돌려주는 값: 받는 노트에 들어간 블록들(없으면 빈 배열)
 */
export async function transferBlocks(input: TransferInput): Promise<readonly string[]> {
  const { api, sourcePath, target, keys, beforeId, link, snapSection } = input
  const sourceNote = api.noteAt(sourcePath)
  if (sourceNote === null || api.noteAt(target.path) === null) {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  if (!link && api.isNoteHeld?.(target.path) === true) {
    announceAction(t('이 노트는 저장 충돌을 풀어야 옮길 수 있습니다'))
    return []
  }
  const box: { result: (BlocksIntoResult & { readonly movedIds?: readonly string[] }) | null } = { result: null }
  let group: object | null = null
  try {
    recordSeparately(() => {
      api.updateNoteAt(target.path, (current) => {
        const result = link
          ? linkBlocksInto(sourceNote, current, keys, beforeId, snapSection)
          : moveBlocksBetweenNotes(sourceNote, current, keys, beforeId, snapSection)
        box.result = result
        return result.target
      })
    })
    group = lastUndoGroup()
  } catch {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  const result = box.result
  if (result === null) {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  const movedIds = !link && 'movedIds' in result && result.movedIds !== undefined ? result.movedIds : []
  if (movedIds.length > 0) {
    // 받는 노트가 파일에 쓰인 것이 확인된 뒤에만 원래 노트에서 뺀다
    const saved = api.flushNote === undefined ? true : await api.flushNote(target.path).catch(() => false)
    if (!saved) {
      announceAction(t('블록을 옮기지 못했습니다'))
      return result.added.map((block) => block.id)
    }
    try {
      resumeUndoGroup(group, () => { api.updateNoteAt(sourcePath, (current) => removeBlocksById(current, movedIds)) })
    } catch {
      announceAction(t('블록을 옮기지 못했습니다'))
      return []
    }
  }
  if (result.skipped > 0) announceAction(t('이미 이 노트에 있는 메모입니다'))
  const first = result.added[0]
  // 탭 위에 놓은 것은 그 노트를 열어 보이지 않는다(보이는 노트에 놓았을 때만 그 블록으로 스크롤한다)
  if (first !== undefined && target.kind === 'body') revealNoteBlock(api, target.path, first.id, { visible: true })
  return result.added.map((block) => block.id)
}

// ---------- 끌기 한 번 ----------

export interface BlockDragSessionInput {
  readonly card: HTMLElement | null
  readonly startX: number
  readonly startY: number
  readonly keys: readonly string[]
  readonly sourcePath: string | null
  readonly snapSection: boolean
  readonly api: () => MemoNoteApi | null
  /** Esc: 이 끌기를 통째로 그만둔다(NoteFlow 가 자기 쪽 정리를 한다) */
  readonly onCancel: () => void
  /** 포인터 자리 계산은 한 프레임에 한 번만 한다. 다른 노트 위인지가 바뀌면(프레임 뒤에 알게 된 것도) 알린다 */
  readonly onCrossingChange?: (crossing: boolean) => void
}

export interface BlockDragSession {
  /** 포인터가 움직였다. crossing 이면 다른 노트 위라 원래 노트의 놓을 자리 줄은 쓰지 않는다 */
  readonly update: (event: PointerEvent) => { readonly crossing: boolean }
  /** 원래 노트가 화면에서 사라졌는가(그 노트의 탭이 다른 노트로 바뀌어 내려갔다). 그러면 노트 안 순서 바꾸기로 이어 가지 않는다 */
  readonly sourceGone: () => boolean
  /**
   * 놓았다. 다른 노트에 놓았거나(옮김·링크) Alt 인데 놓을 노트가 없어 아무 일도 하지 않기로 했으면 true —
   * false 면 원래 노트 안 순서 바꾸기로 이어 간다
   */
  readonly drop: () => boolean
  readonly dispose: () => void
}

export function startBlockDragSession(input: BlockDragSessionInput): BlockDragSession {
  const { card, startX, startY, keys, sourcePath, snapSection, api, onCancel, onCrossingChange } = input
  const carried = (() => {
    const note = sourcePath === null ? null : api()?.noteAt(sourcePath) ?? null
    return note === null ? [] : carriedBlocks(note, keys)
  })()
  // 메모 블록이 하나라도 있으면 링크, 글·소제목만이면 복사
  const linkKind: 'link' | 'copy' = carried.some((block) => block.kind === 'memo') ? 'link' : 'copy'
  const ghost = card === null ? null : createBlockGhost(card, startX, startY, Math.max(carried.length, keys.length))
  // 원래 노트의 스크롤 칸: 끄는 사이 그 칸의 탭이 다른 노트로 바뀌면(spring-load) 이 칸이 사라진다
  const sourceScroller = card?.closest<HTMLElement>('.pdf-memo-bar-scroll, [data-note-path]') ?? null
  const sourceGone = () => sourceScroller !== null && !sourceScroller.isConnected
  let alt = false
  let target: NoteDropTarget | null = null
  let beforeId: string | null = null
  let paintedPane: HTMLElement | null = null
  let spring: { readonly pill: HTMLElement; readonly timer: number } | null = null
  // 끄는 동안 노트의 카드 목록은 스크롤 칸마다 한 번만 찾는다(카드가 사라졌으면 다시 찾는다)
  const cardCache = new Map<HTMLElement, HTMLElement[]>()
  const cardsFor = (scroller: HTMLElement) => {
    let cards = cardCache.get(scroller)
    if (cards === undefined || cards.some((item) => !item.isConnected)) {
      cards = cardsOf(scroller)
      cardCache.set(scroller, cards)
    }
    return cards
  }
  let lastEvent: PointerEvent | null = null
  let lastCrossing = false
  let frame = 0
  let queued = false

  const clearSpring = () => {
    if (spring !== null) window.clearTimeout(spring.timer)
    spring = null
  }
  const refresh = () => {
    ghost?.setBadge(alt ? linkKind : null, target === null)
    document.body.classList.toggle('note-block-drag-copy', alt && target !== null)
  }
  const paintPane = (next: HTMLElement | null) => {
    if (paintedPane === next) return
    paintedPane?.classList.remove('note-block-drop-pane')
    paintedPane = next
    paintedPane?.classList.add('note-block-drop-pane')
  }

  // Alt 만 눌렀다 떼면 Windows 에서 창 메뉴가 포커스를 가져간다: 끄는 동안은 막는다. Esc 는 끌기 전체를 그만둔다
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && event.type === 'keydown') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== 'Alt') return
    event.preventDefault()
    alt = event.type === 'keydown'
    refresh()
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  refresh()

  /** 포인터 자리에서 놓을 곳을 다시 구한다(elementFromPoint · 칸 찾기 · 카드 자리 읽기: 한 프레임에 한 번) */
  const compute = (event: PointerEvent) => {
    alt = event.altKey
    const next = noteTargetAt(event.clientX, event.clientY, sourcePath)
    target = next
    if (next?.kind === 'body') {
      const cards = cardsFor(next.scroller)
      beforeId = dropBeforeIdAt(next.scroller, event.clientY, cards)
      paintDropLine(next.scroller, beforeId, cards)
      paintPane(next.card)
      edgeScroll(next.scroller, event.clientY)
    } else {
      beforeId = null
      paintDropLine(null, null)
      paintPane(null)
    }
    // 노트 탭 위에 머물면 그 탭이 보이는 탭이 된다(이미 보이는 탭이면 아무 일도 없다)
    if (next?.kind === 'tab' && !next.pill.classList.contains('pane-top-tab-active')) {
      if (spring?.pill !== next.pill) {
        clearSpring()
        const pill = next.pill
        spring = { pill, timer: window.setTimeout(() => { spring = null; pill.querySelector<HTMLElement>('.pane-top-tab-title')?.click() }, SPRING_LOAD_MS) }
      }
    } else {
      clearSpring()
    }
    refresh()
    const crossing = next !== null
    if (crossing !== lastCrossing) {
      lastCrossing = crossing
      onCrossingChange?.(crossing)
    }
  }

  const update = (event: PointerEvent) => {
    lastEvent = event
    ghost?.move(event.clientX, event.clientY)
    // 첫 움직임은 바로, 그다음부터는 프레임마다 한 번(마지막 자리로)
    if (frame === 0) {
      compute(event)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        if (queued && lastEvent !== null) { queued = false; compute(lastEvent) }
      })
    } else {
      queued = true
    }
    return { crossing: lastCrossing || sourceGone() }
  }

  const drop = () => {
    // 끌다가 원래 노트가 사라졌으면(탭이 바뀌었다) 놓을 노트가 아니면 아무 일도 하지 않는다
    if (queued && lastEvent !== null) { queued = false; compute(lastEvent) }
    const at = target
    const link = alt
    const api_ = api()
    if (at === null) return link || sourceGone()
    if (api_ === null || sourcePath === null) return true
    void transferBlocks({ api: api_, sourcePath, target: at, keys, beforeId: at.kind === 'tab' ? null : beforeId, link, snapSection })
    return true
  }

  const dispose = () => {
    clearSpring()
    if (frame !== 0) window.cancelAnimationFrame(frame)
    frame = 0
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    paintDropLine(null, null)
    paintPane(null)
    cardCache.clear()
    document.body.classList.remove('note-block-drag-copy')
    ghost?.remove()
  }
  return { update, drop, dispose, sourceGone }
}
