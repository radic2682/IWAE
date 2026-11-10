import { createContext, useContext } from 'react'
import type { MemoNote, MemoNoteEntry } from '../core/memoNote'

/**
 * 오른쪽 바에 열린 메모 노트. PDF 와 따로 열리고(어느 PDF 를 보든 같은 노트), 여러 PDF 의 형광펜 메모와
 * 직접 쓴 글 블록을 담는다. App 이 채우고 PdfPane(오른쪽 바)이 쓴다.
 */
export interface MemoNoteApi {
  readonly entries: readonly MemoNoteEntry[]
  /** 열린 노트(Vault 상대 경로). 없으면 null */
  readonly openPath: string | null
  readonly openTitle: string | null
  readonly openNote: MemoNote | null
  readonly open: (path: string | null) => void
  /** 열린 노트를 닫아 오른쪽 바를 빈 상태로 둔다(다시 켜도 닫힌 채) */
  readonly close?: () => void
  /** 사용자가 노트를 닫아 두었다. 이때는 PDF 에서 글을 골라도 새 노트를 저절로 만들지 않는다 */
  readonly closed?: boolean
  /** 새 노트를 만들어 연다. 만든 경로 */
  readonly create: (title?: string) => Promise<string | null>
  /** 열린 노트를 고친다(저장은 알아서) */
  readonly updateOpen: (change: (note: MemoNote) => MemoNote) => void
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
  /** 이 PDF 에 노트를 만들어 오른쪽 바에 열고 이름을 고치게 한다. 만든 경로 */
  readonly createForDoc?: (docId: string) => Promise<string | null>
}

/** 새 노트를 만든 뒤 오른쪽 바 머리의 이름 칸을 바로 열기 위한 표시(머리가 아직 없을 수도 있어 경로를 기억해 둔다) */
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
