import type { LayoutNode } from '../core/layoutTree'
import { memoNoteTitleOf } from '../core/memoNote'
import { placeNoteTab, type PlaceNoteOutcome } from './noteBeside'
import { allPaneTabs, type PaneId, type PanesState } from './tabs'
import type { PaneChannels } from './workspaceChannels'

/**
 * 예전 오른쪽 노트 바를 쓰던 세션을 「읽기」 배치(문서 | 노트)로 옮긴다(설계 3.6).
 * 노트 바가 열려 있던 세션이면 문서 창 오른쪽에 그 노트를 메모 노트 탭으로 연다. 바를 닫아 두었거나 이미 노트 탭이 있으면 건드리지 않는다.
 * 어떤 탭도 닫지 않는다.
 */

/** 예전 노트 바의 펼침 표시(localStorage). 'off' 가 아니면(없으면 포함) 바가 열려 있었다 */
export const LEGACY_BAR_KEY = 'iwae:pdf-memo-column:v1'

/** Vault 마다 한 번만 옮긴다는 표시의 열쇠 */
export function barMigrationKey(root: string): string {
  return `iwae:note-bar-migrated:v1:${root}`
}

/** 예전 노트 바가 열려 있었는가(저장값이 없으면 기본이 열림) */
export function legacyBarWasOpen(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage === null || storage.getItem(LEGACY_BAR_KEY) !== 'off'
  } catch {
    return true
  }
}

export interface MigrateInput {
  readonly barOpen: boolean
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 지금 보는 문서 창(없으면 null) */
  readonly anchor: PaneId | null
  /** 예전 바가 보이던 노트(기억해 둔 열린 노트, 없으면 이 문서의 노트, 그것도 없으면 첫 노트). 없으면 null */
  readonly notePath: string | null
}

/** 옮길 것이 없으면 null */
export function migrateNoteBar(input: MigrateInput): PlaceNoteOutcome | null {
  const { barOpen, panes, channels, layout, anchor, notePath } = input
  if (!barOpen || anchor === null || notePath === null) return null
  if (allPaneTabs(panes).some((tab) => tab.kind === 'memoNote')) return null
  return placeNoteTab({ panes, channels, layout, anchor, tab: { id: notePath, title: memoNoteTitleOf(notePath), kind: 'memoNote' } })
}
