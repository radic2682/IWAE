import { createContext, useContext } from 'react'
import type { TrashSource } from '../bridge/vaultFiles'
import type { MemoNote, MemoNoteEntry, MemoTicket } from '../core/memoNote'
import type { TicketIndex } from '../core/memoTickets'
import type { PersistentPdfHighlight } from './persistentHighlight'

/**
 * 메모 노트 저장소와 「마지막으로 만진 노트」. 노트는 창의 탭(MemoNoteTabView)으로 보이고, 여러 PDF 의 형광펜 메모와
 * 직접 쓴 글 블록을 담는다. App 이 채우고 노트 탭·문서 창이 쓴다.
 */
export interface MemoNoteApi {
  readonly entries: readonly MemoNoteEntry[]
  /** 마지막으로 만진 메모 노트(마지막으로 포커스·편집·열기를 한 노트 탭, Vault 상대 경로). 없으면 null. 이름은 예전 노트 바 때 것을 그대로 쓴다 */
  readonly openPath: string | null
  readonly openTitle: string | null
  readonly openNote: MemoNote | null
  /** path 를 「마지막으로 만진 노트」로 삼는다(탭은 열지 않는다 — 탭은 openInTab) */
  readonly open: (path: string | null) => void
  /** 새 노트를 만든다(마지막으로 만진 노트가 된다). 만든 경로 */
  readonly create: (title?: string) => Promise<string | null>
  /** 마지막으로 만진 노트를 고친다(저장은 알아서) */
  readonly updateOpen: (change: (note: MemoNote) => MemoNote) => void
  /** path 노트의 지금 내용. 목록에 없으면 null. 탭으로 연 노트가 이것으로 그린다 */
  readonly noteAt: (path: string) => MemoNote | null
  /** path 노트를 고친다(저장은 알아서; updateOpen 과 같은 길). 목록에 없는 노트는 무시 */
  readonly updateNoteAt: (path: string, change: (note: MemoNote) => MemoNote) => void
  /** 노트를 창의 탭으로 연다(문서 창 옆에, 이미 노트를 보이는 창이 있으면 그 창의 탭으로). 없으면 노트 열기 메뉴를 보이지 않는다 */
  readonly openInTab?: (path: string) => void
  /** 노트 이름을 바꾼다(새 경로). 없으면 이름 바꾸기를 보이지 않는다 */
  readonly rename?: (path: string, title: string) => Promise<string>
  /** 이 형광펜을 담은 노트들 */
  readonly notesOf: (highlightId: string) => readonly string[]
  /**
   * 문서 id → 그 문서가 노트를 가지는 줄의 열쇠(버전 묶음이면 대표 문서 id). PDF 가 아니거나 모르는 문서면 null.
   * 없으면 노트를 PDF 별로 나누지 않는다.
   */
  readonly docOwner?: (docId: string) => string | null
  /** 문서 id → 사람이 읽는 이름(버전 묶음이면 묶음 이름) */
  readonly docLabel?: (docId: string) => string
  /** 노트 하나를 휴지통으로 옮기고 그 노트의 이모지·색을 정리한다(그 노트의 탭도 닫힌다). 없으면 노트 열기 메뉴에 지우기 항목을 보이지 않는다 */
  readonly trashNote?: (path: string, source: TrashSource) => Promise<void>
  /** 이 PDF 에 노트를 만든다(만든 경로). 열기는 호출하는 쪽이 한다 */
  readonly createForDoc?: (docId: string) => Promise<string | null>
  /** 모든 노트의 티켓(ID 가 붙은 메모 블록)을 ID 별로 모은 것: 같은 ID 가 놓인 곳들과 충돌 */
  readonly tickets?: TicketIndex
  /**
   * 열린 노트(path 가 있으면 그 노트)의 블록 하나의 ID·제목을 바꾼다. 같은 ID·같은 형광펜을 가진 다른 블록(다른 노트 포함)도 같은 값으로 맞추고,
   * 되돌리기는 한 번에 모두 되돌린다. null 이면 ID·제목을 지운다
   */
  readonly setTicket?: (blockId: string, ticket: MemoTicket | null, path?: string) => void
  /** 형광펜 id → 형광펜(티켓 고르기의 원문 글) */
  readonly highlightOf?: (highlightId: string) => PersistentPdfHighlight | undefined
}

/** 노트 블록으로 가서 보여 주기: 그 노트를 탭으로 열고(이미 보이면 그대로), 그 블록으로 스크롤해 잠깐 깜빡인다 */
export interface BlockReveal {
  readonly path: string
  readonly blockId: string
}
let pendingReveal: (BlockReveal & { readonly at: number }) | null = null
/** 요청 뒤 이 시간이 지나도 블록을 못 찾으면 그만둔다(지워진 블록·닫힌 노트) */
const REVEAL_EXPIRES_MS = 5000
const revealListeners = new Set<() => void>()

/** path 노트의 blockId 블록을 보인다. 노트가 이미 열려 있으면 바로, 아니면 열린 뒤에 */
export function revealNoteBlock(api: Pick<MemoNoteApi, 'open' | 'openPath' | 'openInTab'>, path: string, blockId: string): void {
  pendingReveal = { path, blockId, at: Date.now() }
  if (api.openInTab !== undefined) api.openInTab(path)
  else if (api.openPath !== path) api.open(path)
  for (const listener of revealListeners) listener()
}

export function peekBlockReveal(): BlockReveal | null {
  if (pendingReveal !== null && Date.now() - pendingReveal.at > REVEAL_EXPIRES_MS) pendingReveal = null
  return pendingReveal
}

export function clearBlockReveal(): void {
  pendingReveal = null
}

export function onBlockRevealRequest(listener: () => void): () => void {
  revealListeners.add(listener)
  return () => { revealListeners.delete(listener) }
}

/** 새 노트를 만든 뒤 노트 탭 도구줄의 이름 칸을 바로 열기 위한 표시(탭이 아직 없을 수도 있어 경로를 기억해 둔다) */
let pendingTitleEdit: string | null = null
const titleEditListeners = new Set<() => void>()

export function requestTitleEdit(path: string): void {
  pendingTitleEdit = path
  for (const listener of titleEditListeners) listener()
}

/** path 가 이름 고치기를 기다리고 있으면 true 를 돌려주고 표시를 지운다 */
export function takeTitleEdit(path: string | null): boolean {
  if (path === null || pendingTitleEdit !== path) return false
  pendingTitleEdit = null
  return true
}

export function onTitleEditRequest(listener: () => void): () => void {
  titleEditListeners.add(listener)
  return () => { titleEditListeners.delete(listener) }
}

export const MemoNoteContext = createContext<MemoNoteApi | null>(null)

export function useMemoNoteApi(): MemoNoteApi | null {
  return useContext(MemoNoteContext)
}
