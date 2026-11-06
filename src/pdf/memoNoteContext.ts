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
}

export const MemoNoteContext = createContext<MemoNoteApi | null>(null)

export function useMemoNoteApi(): MemoNoteApi | null {
  return useContext(MemoNoteContext)
}
