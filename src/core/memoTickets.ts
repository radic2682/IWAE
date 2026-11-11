/**
 * 티켓(ID 가 붙은 메모 블록)을 노트 전체에서 모아 본다.
 *
 * - 같은 ID 를 가진 메모 블록은 같은 메모다. 같은 형광펜을 가리키면 글·댓글은 이미 하나이고,
 *   ID·제목은 {@link syncTicketEdit} 가 모든 블록에 같게 맞춘다.
 * - 같은 ID 인데 가리키는 형광펜이 다르면 합치지 않고 「충돌」로 보인다(어느 쪽이 맞는지는 사람이 정한다).
 * - ID 가 없는(제목만 있는) 블록은 짝지을 열쇠가 없어 여기서 다루지 않는다.
 */

import { normalizeTicket, setMemoTicket, type MemoNote, type MemoTicket } from './memoNote'

/** ID 를 견주는 열쇠: 앞뒤 빈칸과 대소문자를 무시한다(REQ-01 = req-01) */
export function ticketKey(id: string): string {
  return id.trim().toLowerCase()
}

/** 티켓이 놓인 한 자리 */
export interface TicketPlace {
  /** 노트 경로(Vault 상대) */
  readonly path: string
  readonly blockId: string
  /** 노트 안 블록 차례(0 부터) */
  readonly index: number
  /** 그 블록이 속한 소제목의 제목(소제목 앞이면 null) */
  readonly section: string | null
  readonly highlightId: string
  readonly ticket: MemoTicket
}

/** 같은 ID 를 쓰는 자리들 */
export interface TicketGroup {
  readonly key: string
  /** 보여 줄 ID(첫 자리의 표기) */
  readonly id: string
  readonly places: readonly TicketPlace[]
  /** 이 ID 가 가리키는 형광펜들(둘 이상이면 충돌) */
  readonly highlightIds: readonly string[]
  readonly conflict: boolean
}

export interface TicketIndex {
  /** ID 열쇠 → 그 ID 를 쓰는 자리들 */
  readonly groups: ReadonlyMap<string, TicketGroup>
}

export const EMPTY_TICKET_INDEX: TicketIndex = { groups: new Map() }

/** 노트들을 훑어 ID 가 있는 메모 블록을 ID 별로 모은다. 노트는 받은 차례, 블록은 노트 안 차례대로 */
export function buildTicketIndex(notes: ReadonlyMap<string, MemoNote>): TicketIndex {
  const found = new Map<string, TicketPlace[]>()
  for (const [path, note] of notes) {
    let section: string | null = null
    note.blocks.forEach((block, index) => {
      if (block.kind === 'section') {
        section = block.title
        return
      }
      if (block.kind !== 'memo' || block.ticket?.id === undefined) return
      const key = ticketKey(block.ticket.id)
      if (key === '') return
      const places = found.get(key) ?? []
      places.push({ path, blockId: block.id, index, section, highlightId: block.highlightId, ticket: block.ticket })
      found.set(key, places)
    })
  }
  const groups = new Map<string, TicketGroup>()
  for (const [key, places] of found) {
    const highlightIds = [...new Set(places.map((place) => place.highlightId))]
    groups.set(key, { key, id: places[0]?.ticket.id ?? key, places, highlightIds, conflict: highlightIds.length > 1 })
  }
  return { groups }
}

/** 이 ID 를 쓰는 자리들(없으면 undefined) */
export function ticketGroupOf(index: TicketIndex, id: string | undefined): TicketGroup | undefined {
  if (id === undefined) return undefined
  const key = ticketKey(id)
  return key === '' ? undefined : index.groups.get(key)
}

/** 고르기 목록의 한 줄: 같은 ID·같은 형광펜인 자리들을 하나로 본다 */
export interface TicketChoice {
  readonly id: string
  readonly title: string | undefined
  readonly highlightId: string
  readonly ticket: MemoTicket
  /** 이 티켓이 놓인 자리들(첫 자리가 대표) */
  readonly places: readonly TicketPlace[]
  /** 같은 ID 를 다른 형광펜이 쓰고 있다 */
  readonly conflict: boolean
}

/** 모든 노트의 티켓을 ID 차례로(숫자는 숫자로) */
export function ticketChoices(index: TicketIndex): TicketChoice[] {
  const choices: TicketChoice[] = []
  for (const group of index.groups.values()) {
    for (const highlightId of group.highlightIds) {
      const places = group.places.filter((place) => place.highlightId === highlightId)
      const first = places[0]
      if (first === undefined) continue
      choices.push({ id: first.ticket.id ?? group.id, title: first.ticket.title, highlightId, ticket: first.ticket, places, conflict: group.conflict })
    }
  }
  return choices.sort((a, b) => a.id.localeCompare(b.id, 'ko-KR', { numeric: true, sensitivity: 'base' }))
}

/**
 * 한 블록의 ID·제목을 바꿀 때 같은 메모(같은 ID + 같은 형광펜)의 다른 블록에도 같은 값을 준다.
 * 돌려주는 것은 바뀐 노트들(경로 → 새 노트)뿐이다. 바꾸는 블록이 없으면 빈 맵.
 *
 * - 바뀌는 블록의 옛 ID 가 짝을 찾는 열쇠다. 옛 ID 가 없던 블록(처음 ID 를 붙이는 때)은 짝이 없어 그 블록만 바뀐다.
 * - 같은 ID 라도 다른 형광펜을 가리키는 블록(충돌)은 건드리지 않는다.
 * - next 가 null(ID·제목 지우기)이면 짝들도 그냥 메모로 돌아간다: 같은 메모이므로 한 곳에서 지운 것은 다 지운다.
 */
export function syncTicketEdit(
  notes: ReadonlyMap<string, MemoNote>,
  path: string,
  blockId: string,
  next: MemoTicket | null,
): ReadonlyMap<string, MemoNote> {
  const note = notes.get(path)
  const block = note?.blocks.find((item) => item.id === blockId)
  if (note === undefined || block === undefined || block.kind !== 'memo') return new Map()
  const normalized = normalizeTicket(next)
  const oldKey = block.ticket?.id === undefined ? '' : ticketKey(block.ticket.id)
  const changed = new Map<string, MemoNote>()
  for (const [notePath, current] of notes) {
    let updated = current
    for (const item of current.blocks) {
      if (item.kind !== 'memo') continue
      const self = notePath === path && item.id === blockId
      const sibling = !self && oldKey !== '' && item.highlightId === block.highlightId && item.ticket?.id !== undefined && ticketKey(item.ticket.id) === oldKey
      if (!self && !sibling) continue
      if (sameTicket(item.ticket, normalized)) continue
      updated = setMemoTicket(updated, item.id, normalized)
    }
    if (updated !== current) changed.set(notePath, updated)
  }
  return changed
}

function sameTicket(a: MemoTicket | undefined, b: MemoTicket | null): boolean {
  return (a?.id ?? '') === (b?.id ?? '') && (a?.title ?? '') === (b?.title ?? '')
}
