/**
 * 메모 블록 끌기의 노트 밖 쪽: 손에 붙어 따라오는 모양(ghost), 놓을 노트 찾기, 탭 위에 얹어 노트 바꾸기(spring-load),
 * Alt 로 링크·복사, 노트 사이 옮기기. 같은 노트 안 순서 바꾸기는 NoteFlow 가 그대로 맡고, 여기는 「다른 노트 위에 있는가」만 안다.
 *
 * 놓을 자리는 마우스 밑 요소가 아니라 칸의 자리(paneHitAt)로 정한다 — 끄는 동안 칸 안 내용은 마우스를 받지 않는다(note-block-drag.css).
 */

import { paneHitAt } from '../app/tabDrag'
import { announceAction } from '../app/actionFeedback'
import { recordSeparately } from '../app/undoStack'
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
function cardsOf(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>('[data-note-block]')).filter((card) => card.dataset.noteBlock !== 'draft')
}

/** 포인터 높이에서 놓을 자리: 가운데선 아래로 처음 내려가는 카드 앞(없으면 null = 맨 끝). 원래 노트의 dropIndexAt 과 같은 규칙 */
export function dropBeforeIdAt(scroller: HTMLElement, clientY: number): string | null {
  const before = cardsOf(scroller).find((card) => {
    const rect = card.getBoundingClientRect()
    return clientY < rect.top + rect.height / 2
  })
  return before?.dataset.noteBlock ?? null
}

/** 놓을 자리 줄을 그린다(원래 노트가 쓰는 클래스 그대로). beforeId 가 null 이면 마지막 카드 아래 */
function paintDropLine(scroller: HTMLElement | null, beforeId: string | null): void {
  for (const card of document.querySelectorAll('.pdf-memo-card-drop-before.note-block-ghost-line, .pdf-memo-card-drop-after.note-block-ghost-line')) {
    card.classList.remove('pdf-memo-card-drop-before', 'pdf-memo-card-drop-after', 'note-block-ghost-line')
  }
  if (scroller === null) return
  const cards = cardsOf(scroller)
  const anchor = beforeId === null ? cards.at(-1) : cards.find((card) => card.dataset.noteBlock === beforeId)
  anchor?.classList.add(beforeId === null ? 'pdf-memo-card-drop-after' : 'pdf-memo-card-drop-before', 'note-block-ghost-line')
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

/** 카드의 작은 복사본이 잡은 자리를 그대로 두고 따라온다. 카드 스타일이 걸리도록 카드를 둘러싼 껍질의 클래스를 그대로 입힌다 */
export function createBlockGhost(card: HTMLElement, startX: number, startY: number, count: number): BlockGhost {
  const rect = card.getBoundingClientRect()
  const width = Math.max(80, Math.min(GHOST_MAX_WIDTH, rect.width))
  const grabX = Math.min(Math.max(startX - rect.left, 8), width - 8)
  const grabY = Math.min(Math.max(startY - rect.top, 8), 40)
  const computed = getComputedStyle(card)
  const background = computed.backgroundColor === 'rgba(0, 0, 0, 0)' || computed.backgroundColor === 'transparent' ? 'var(--paper)' : computed.backgroundColor

  const clone = card.cloneNode(true) as HTMLElement
  for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]) {
    for (const name of ['id', 'data-note-block', 'data-memo-id', 'tabindex', 'contenteditable']) element.removeAttribute(name)
  }
  clone.classList.remove('pdf-memo-card-dragging', 'pdf-memo-card-drop-before', 'pdf-memo-card-drop-after', 'note-block-selected', 'note-block-ghost-line')
  clone.querySelectorAll('.note-block-tabs, .note-gap').forEach((element) => element.remove())
  clone.style.cssText = 'position:relative;inset:auto;margin:0;width:100%;opacity:1;transform:none;box-shadow:none;'

  // 카드가 노트 칸 안에서만 맞는 규칙을 받도록 칸 안 껍질(.pane-doc › 본문 › 스크롤) 클래스를 입힌 빈 껍질 안에 둔다
  const scroller = card.closest<HTMLElement>('.pdf-memo-bar-scroll')
  let inner: HTMLElement = clone
  for (const source of [scroller, scroller?.parentElement ?? null, card.closest<HTMLElement>('.pane-doc')]) {
    if (source === null || source === undefined) continue
    const wrap = document.createElement('div')
    wrap.className = `${source.className} note-block-ghost-wrap`
    wrap.append(inner)
    inner = wrap
  }

  const root = document.createElement('div')
  root.className = 'note-block-ghost'
  root.setAttribute('aria-hidden', 'true')
  root.style.width = `${width}px`
  root.style.borderRadius = computed.borderRadius
  root.style.background = background
  const clip = document.createElement('div')
  clip.className = 'note-block-ghost-clip'
  clip.append(inner)
  root.append(clip)

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

  const place = (x: number, y: number) => { root.style.transform = `translate(${Math.round(x - grabX)}px, ${Math.round(y - grabY)}px)` }
  place(startX, startY)
  document.body.append(root)
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
 * 블록을 다른 노트에 옮기거나(링크·복사) 한다. 받는 노트를 먼저 쓰고 성공했을 때만 원래 노트에서 지운다 —
 * 실패하면 알리고 원래 노트는 건드리지 않는다. 노트 두 개를 고쳐도 되돌리기는 한 번(recordSeparately)이다.
 * 돌려주는 값: 받는 노트에 들어간 블록들(없으면 빈 배열)
 */
export function transferBlocks(input: TransferInput): readonly string[] {
  const { api, sourcePath, target, keys, beforeId, link, snapSection } = input
  const sourceNote = api.noteAt(sourcePath)
  if (sourceNote === null || api.noteAt(target.path) === null) {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  const box: { result: (BlocksIntoResult & { readonly movedIds?: readonly string[] }) | null } = { result: null }
  try {
    recordSeparately(() => {
      api.updateNoteAt(target.path, (current) => {
        const result = link
          ? linkBlocksInto(sourceNote, current, keys, beforeId, snapSection)
          : moveBlocksBetweenNotes(sourceNote, current, keys, beforeId, snapSection)
        box.result = result
        return result.target
      })
      const done = box.result
      // 받는 노트를 쓴 것이 확인된 뒤에만 원래 노트에서 뺀다
      if (!link && done !== null && 'movedIds' in done && done.movedIds !== undefined && done.movedIds.length > 0) {
        const movedIds = done.movedIds
        api.updateNoteAt(sourcePath, (current) => removeBlocksById(current, movedIds))
      }
    })
  } catch {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  const result = box.result
  if (result === null) {
    announceAction(t('블록을 옮기지 못했습니다'))
    return []
  }
  if (result.skipped > 0) announceAction(t('이미 이 노트에 있는 메모입니다'))
  const first = result.added[0]
  // 탭 위에 놓은 것은 그 노트를 열어 보이지 않는다(보이는 노트에 놓았을 때만 그 블록으로 스크롤한다)
  if (first !== undefined && target.kind === 'body') revealNoteBlock(api, target.path, first.id)
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
}

export interface BlockDragSession {
  /** 포인터가 움직였다. crossing 이면 다른 노트 위라 원래 노트의 놓을 자리 줄은 쓰지 않는다 */
  readonly update: (event: PointerEvent) => { readonly crossing: boolean }
  /**
   * 놓았다. 다른 노트에 놓았거나(옮김·링크) Alt 인데 놓을 노트가 없어 아무 일도 하지 않기로 했으면 true —
   * false 면 원래 노트 안 순서 바꾸기로 이어 간다
   */
  readonly drop: () => boolean
  readonly dispose: () => void
}

export function startBlockDragSession(input: BlockDragSessionInput): BlockDragSession {
  const { card, startX, startY, keys, sourcePath, snapSection, api, onCancel } = input
  const carried = (() => {
    const note = sourcePath === null ? null : api()?.noteAt(sourcePath) ?? null
    return note === null ? [] : carriedBlocks(note, keys)
  })()
  // 메모 블록이 하나라도 있으면 링크, 글·소제목만이면 복사
  const linkKind: 'link' | 'copy' = carried.some((block) => block.kind === 'memo') ? 'link' : 'copy'
  const ghost = card === null ? null : createBlockGhost(card, startX, startY, Math.max(carried.length, keys.length))
  let alt = false
  let target: NoteDropTarget | null = null
  let beforeId: string | null = null
  let paintedPane: HTMLElement | null = null
  let spring: { readonly pill: HTMLElement; readonly timer: number } | null = null

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

  const update = (event: PointerEvent) => {
    alt = event.altKey
    ghost?.move(event.clientX, event.clientY)
    const next = noteTargetAt(event.clientX, event.clientY, sourcePath)
    target = next
    if (next?.kind === 'body') {
      beforeId = dropBeforeIdAt(next.scroller, event.clientY)
      paintDropLine(next.scroller, beforeId)
      paintPane(next.card)
      const rect = next.scroller.getBoundingClientRect()
      if (event.clientY < rect.top + EDGE_SCROLL_BAND) next.scroller.scrollTop -= EDGE_SCROLL_STEP
      else if (event.clientY > rect.bottom - EDGE_SCROLL_BAND) next.scroller.scrollTop += EDGE_SCROLL_STEP
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
    return { crossing: next !== null }
  }

  const drop = () => {
    const at = target
    const link = alt
    const api_ = api()
    if (at === null) return link
    if (api_ === null || sourcePath === null) return true
    transferBlocks({ api: api_, sourcePath, target: at, keys, beforeId: at.kind === 'tab' ? null : beforeId, link, snapSection })
    return true
  }

  const dispose = () => {
    clearSpring()
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    paintDropLine(null, null)
    paintPane(null)
    document.body.classList.remove('note-block-drag-copy')
    ghost?.remove()
  }
  return { update, drop, dispose }
}
